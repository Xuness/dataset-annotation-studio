from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import uuid
from collections.abc import Callable
from pathlib import Path

from dataset_studio.core.files import atomic_write_text
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.taggers.adapters.base import ValidatedTaggerModel
from dataset_studio.modules.taggers.models import (
    TaggerFileRecord,
    TaggerInstallationManifest,
    TaggerSourceRecord,
)
from dataset_studio.modules.taggers.registry import TaggerAdapterRegistry
from dataset_studio.modules.taggers.repository import TaggerRepository
from dataset_studio.modules.taggers.sources.base import (
    TaggerDownloadPlan,
    TaggerMaterializedModel,
)

MANIFEST_NAME = "installation.json"
_SAFE_SEGMENT = re.compile(r"[^0-9A-Za-z._-]+")


class TaggerInstaller:
    def __init__(
        self,
        repository: TaggerRepository,
        registry: TaggerAdapterRegistry,
        model_root: Callable[[], Path],
    ) -> None:
        self._repository = repository
        self._registry = registry
        self._model_root = model_root

    def import_local(
        self,
        source: Path,
        *,
        requested_name: str | None,
    ) -> TaggerInstallationManifest:
        adapter, validated = self._registry.detect(source)
        root = self._model_root()
        root.mkdir(parents=True, exist_ok=True)
        installation_id = str(uuid.uuid4())
        staging = (root / ".staging" / installation_id).resolve()
        self._require_child(root, staging)
        if staging.exists():
            raise ValueError("模型安装暂存目录发生冲突，请重试。")

        total_size = sum((source / name).stat().st_size for name in validated.managed_files)
        if shutil.disk_usage(root).free < total_size + 64 * 1024 * 1024:
            raise ValueError("模型库可用空间不足，无法复制所选模型。")

        try:
            staging.mkdir(parents=True)
            files = [
                self.copy_and_hash(source, staging, relative_path)
                for relative_path in validated.managed_files
            ]
            copied_validation = adapter.validate(staging)
            name = (requested_name or f"{adapter.name} {copied_validation.model_version}").strip()
            return self._publish(
                staging,
                installation_id=installation_id,
                name=name,
                validated=copied_validation,
                files=files,
                source=TaggerSourceRecord(
                    source_type="local_import",
                    original_path=str(source),
                ),
            )
        finally:
            if staging.exists():
                shutil.rmtree(staging, ignore_errors=True)

    def install_materialized(
        self,
        materialized: TaggerMaterializedModel,
        plan: TaggerDownloadPlan,
    ) -> TaggerInstallationManifest:
        root = self._model_root()
        directory = materialized.directory.resolve()
        self._require_child(root, directory)
        if not directory.is_dir():
            raise ValueError("下载完成的模型暂存目录不存在。")
        adapter = self._registry.get(plan.adapter_id)
        if not adapter.detect(directory):
            raise ValueError("下载完成的文件不符合目标打标器目录结构。")
        validated = adapter.validate(directory)
        if validated.adapter_id != plan.adapter_id:
            raise ValueError("下载完成的模型与审核计划适配器不一致。")
        if validated.model_version != plan.model_version:
            raise ValueError("下载完成的模型版本与审核计划不一致。")

        expected_files = {file.relative_path: file for file in plan.files}
        expected_paths = set(expected_files)
        managed_paths = set(validated.managed_files)
        if managed_paths != expected_paths:
            raise ValueError("下载计划文件集合与适配器管理文件集合不一致。")
        by_path = {file.relative_path: file for file in materialized.files}
        if set(by_path) != expected_paths:
            raise ValueError("下载完成的文件记录不完整。")

        records: list[TaggerFileRecord] = []
        for relative_path in validated.managed_files:
            materialized_file = by_path[relative_path]
            expected_file = expected_files[relative_path]
            if (
                materialized_file.size != expected_file.size
                or materialized_file.sha256 != expected_file.sha256
            ):
                raise ValueError(f"下载完成的模型文件与审核计划不一致：{relative_path}")
            path = (directory / relative_path).resolve()
            if not path.is_relative_to(directory) or path.is_symlink() or not path.is_file():
                raise ValueError(f"下载完成的模型文件路径不安全：{relative_path}")
            stat = path.stat()
            if (
                stat.st_size != materialized_file.size
                or stat.st_mtime_ns != materialized_file.modified_ns
            ):
                raise ValueError(f"下载完成的模型文件在校验后发生变化：{relative_path}")
            records.append(
                TaggerFileRecord(
                    relative_path=relative_path,
                    size=materialized_file.size,
                    modified_ns=materialized_file.modified_ns,
                    sha256=materialized_file.sha256,
                )
            )

        return self._publish(
            directory,
            installation_id=str(uuid.uuid4()),
            name=plan.name,
            validated=validated,
            files=records,
            source=TaggerSourceRecord(
                source_type="huggingface",
                plan_id=plan.plan_id,
                repo_id=plan.source_id,
                revision=plan.revision,
            ),
        )

    def build_manifest(
        self,
        *,
        installation_id: str,
        name: str,
        validated: ValidatedTaggerModel,
        files: list[TaggerFileRecord],
        source: TaggerSourceRecord,
        created_at: str,
    ) -> TaggerInstallationManifest:
        capabilities = validated.profile_capabilities
        unknown_defaults = sorted(set(capabilities.default_categories) - set(validated.categories))
        if unknown_defaults:
            raise ValueError("适配器默认配置包含未知类别：" + "、".join(unknown_defaults))
        unknown_thresholds = sorted(
            set(capabilities.default_selection.category_thresholds) - set(validated.categories)
        )
        if unknown_thresholds:
            raise ValueError("适配器默认阈值包含未知类别：" + "、".join(unknown_thresholds))
        fingerprint_payload = {
            "adapter_id": validated.adapter_id,
            "adapter_contract_version": validated.adapter_contract_version,
            "model_version": validated.model_version,
            "files": [
                {"path": file.relative_path, "size": file.size, "sha256": file.sha256}
                for file in files
            ],
        }
        fingerprint = hashlib.sha256(
            json.dumps(fingerprint_payload, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        return TaggerInstallationManifest(
            installation_id=installation_id,
            name=name,
            adapter_id=validated.adapter_id,
            adapter_contract_version=validated.adapter_contract_version,
            model_version=validated.model_version,
            fingerprint=fingerprint,
            tag_count=validated.tag_count,
            categories=validated.categories,
            profile_capabilities=validated.profile_capabilities,
            warnings=list(validated.warnings),
            files=files,
            source=source,
            created_at=created_at,
            validated_at=utc_now_iso(),
        )

    @staticmethod
    def copy_and_hash(
        source_root: Path,
        target_root: Path,
        relative_path: str,
    ) -> TaggerFileRecord:
        source = (source_root / relative_path).resolve()
        target = (target_root / relative_path).resolve()
        if not source.is_relative_to(source_root) or source.is_symlink() or not source.is_file():
            raise ValueError(f"模型文件路径不安全：{relative_path}")
        if not target.is_relative_to(target_root):
            raise ValueError(f"模型文件目标路径不安全：{relative_path}")
        target.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        with source.open("rb") as reader, target.open("xb") as writer:
            while chunk := reader.read(8 * 1024 * 1024):
                writer.write(chunk)
                digest.update(chunk)
            writer.flush()
            os.fsync(writer.fileno())
        shutil.copystat(source, target, follow_symlinks=False)
        stat = target.stat()
        return TaggerFileRecord(
            relative_path=relative_path,
            size=stat.st_size,
            modified_ns=stat.st_mtime_ns,
            sha256=digest.hexdigest(),
        )

    @staticmethod
    def hash_file(root: Path, relative_path: str) -> TaggerFileRecord:
        path = (root / relative_path).resolve()
        if not path.is_relative_to(root) or path.is_symlink() or not path.is_file():
            raise ValueError(f"模型文件路径不安全：{relative_path}")
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            while chunk := handle.read(8 * 1024 * 1024):
                digest.update(chunk)
        stat = path.stat()
        return TaggerFileRecord(
            relative_path=relative_path,
            size=stat.st_size,
            modified_ns=stat.st_mtime_ns,
            sha256=digest.hexdigest(),
        )

    def _publish(
        self,
        staging: Path,
        *,
        installation_id: str,
        name: str,
        validated: ValidatedTaggerModel,
        files: list[TaggerFileRecord],
        source: TaggerSourceRecord,
    ) -> TaggerInstallationManifest:
        root = self._model_root()
        now = utc_now_iso()
        safe_version = _safe_segment(validated.model_version)
        target = (root / validated.adapter_id / f"{safe_version}-{installation_id[:8]}").resolve()
        self._require_child(root, target)
        if target.exists():
            raise ValueError("模型安装目录发生冲突，请重试。")
        manifest = self.build_manifest(
            installation_id=installation_id,
            name=name,
            validated=validated,
            files=files,
            source=source,
            created_at=now,
        )
        atomic_write_text(
            staging / MANIFEST_NAME,
            manifest.model_dump_json(indent=2) + "\n",
        )
        target.parent.mkdir(parents=True, exist_ok=True)
        os.replace(staging, target)
        relative_path = target.relative_to(root).as_posix()
        try:
            self._repository.insert_installation(
                self.installation_values(manifest, relative_path, now)
            )
        except BaseException:
            staging.parent.mkdir(parents=True, exist_ok=True)
            if staging.exists():
                shutil.rmtree(staging, ignore_errors=True)
            os.replace(target, staging)
            raise
        return manifest

    @staticmethod
    def installation_values(
        manifest: TaggerInstallationManifest,
        relative_path: str,
        updated_at: str,
    ) -> tuple[object, ...]:
        return (
            manifest.installation_id,
            manifest.name,
            manifest.adapter_id,
            manifest.model_version,
            relative_path,
            manifest.fingerprint,
            manifest.model_dump_json(),
            manifest.created_at,
            updated_at,
        )

    @staticmethod
    def _require_child(root: Path, path: Path) -> None:
        if path == root or not path.is_relative_to(root):
            raise ValueError("模型安装路径超出当前模型库。")


def _safe_segment(value: str) -> str:
    normalized = _SAFE_SEGMENT.sub("-", value.strip()).strip(".-")
    return normalized[:60] or "model"
