from __future__ import annotations

import hashlib
import os
import shutil
import stat
import uuid
import zipfile
from pathlib import Path

from dataset_studio.core.files import atomic_copy_file_with_sha256, atomic_write_text, file_sha256
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.tag_dictionaries.adapters.base import (
    DICTIONARY_DATABASE_NAME,
    TagDictionaryAdapter,
    build_normalized_database,
    validate_normalized_database,
)
from dataset_studio.modules.tag_dictionaries.models import (
    TagDictionaryManifest,
    TagDictionarySourceRecord,
)
from dataset_studio.modules.tag_dictionaries.registry import TagDictionaryAdapterRegistry
from dataset_studio.modules.tag_dictionaries.repository import TagDictionaryRepository

MANIFEST_NAME = "installation.json"
_MAX_ARCHIVE_FILES = 10_000
_MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024
_DISK_RESERVE = 64 * 1024 * 1024


class TagDictionaryInstaller:
    def __init__(
        self,
        repository: TagDictionaryRepository,
        registry: TagDictionaryAdapterRegistry,
        dictionary_root,
    ) -> None:
        self._repository = repository
        self._registry = registry
        self._dictionary_root = dictionary_root

    def import_local(self, source: Path, *, requested_name: str | None) -> TagDictionaryManifest:
        source = source.resolve()
        if not source.exists():
            raise ValueError("选择的词典文件或目录不存在。")
        if source.is_file() and source.suffix.casefold() == ".zip":
            # WeiLin is the only current adapter with a declared archive input.
            # The archive is still extracted through the guarded path below and
            # must pass adapter detection and validation after extraction.
            adapter = self._registry.get("weilin_prompt")
            source_version = ""
        else:
            adapter = self._registry.detect(source)
            source_version = adapter.validate(source).source_version
        source_record = TagDictionarySourceRecord(
            source_type="local_import",
            source_id=adapter.source_id,
            source_version=source_version,
            source_url=adapter.source_url,
            original_path=str(source),
            source_sha256="0" * 64,
        )
        return self._install(
            source,
            adapter=adapter,
            source_record=source_record,
            requested_name=requested_name,
        )

    def install_catalog_download(
        self,
        source: Path,
        *,
        adapter_id: str,
        source_record: TagDictionarySourceRecord,
        requested_name: str,
    ) -> TagDictionaryManifest:
        adapter = self._registry.get(adapter_id)
        return self._install(
            source.resolve(),
            adapter=adapter,
            source_record=source_record,
            requested_name=requested_name,
        )

    def _install(
        self,
        source: Path,
        *,
        adapter: TagDictionaryAdapter,
        source_record: TagDictionarySourceRecord,
        requested_name: str | None,
    ) -> TagDictionaryManifest:
        root = self._dictionary_root()
        root.mkdir(parents=True, exist_ok=True)
        installation_id = str(uuid.uuid4())
        staging = (root / ".staging" / installation_id).resolve()
        self._require_child(root, staging)
        if staging.exists():
            raise ValueError("词典安装暂存目录发生冲突，请重试。")
        if shutil.disk_usage(root).free < _source_size(source) * 2 + _DISK_RESERVE:
            raise ValueError("词典目录可用空间不足，无法复制并建立索引。")

        try:
            staging.mkdir(parents=True)
            materialized_source, source_sha256 = self._materialize_source(
                source,
                staging / "source",
                adapter,
            )
            copied_validation = adapter.validate(materialized_source)
            built = build_normalized_database(
                staging / DICTIONARY_DATABASE_NAME,
                adapter.entries(materialized_source),
                adapter_id=adapter.id,
                adapter_version=adapter.contract_version,
                language=copied_validation.language,
            )
            existing = next(
                (
                    row
                    for row in self._repository.list_installations()
                    if str(row["fingerprint"]) == built.fingerprint
                ),
                None,
            )
            if existing is not None:
                raise ValueError(f"相同内容的词典已经安装：{existing['name']}")

            database_sha256 = file_sha256(staging / DICTIONARY_DATABASE_NAME)
            timestamp = utc_now_iso()
            name = (requested_name or copied_validation.recommended_name).strip()
            record = source_record.model_copy(
                update={
                    "source_version": source_record.source_version
                    or copied_validation.source_version,
                    "source_sha256": source_sha256,
                }
            )
            manifest = TagDictionaryManifest(
                installation_id=installation_id,
                name=name,
                adapter_id=adapter.id,
                adapter_version=adapter.contract_version,
                source_id=record.source_id,
                source_version=record.source_version,
                source_url=record.source_url,
                language=copied_validation.language,
                entry_count=built.entry_count,
                fingerprint=built.fingerprint,
                database_sha256=database_sha256,
                source=record,
                license_id=adapter.license_id,
                license_url=adapter.license_url,
                license_status=adapter.license_status,
                installed_at=timestamp,
            )
            atomic_write_text(
                staging / MANIFEST_NAME,
                manifest.model_dump_json(indent=2),
            )
            return self._publish(staging, manifest)
        finally:
            if staging.exists():
                shutil.rmtree(staging, ignore_errors=True)

    def _publish(self, staging: Path, manifest: TagDictionaryManifest) -> TagDictionaryManifest:
        root = self._dictionary_root()
        target = (root / "installations" / manifest.installation_id).resolve()
        self._require_child(root, target)
        if target.exists():
            raise ValueError("词典安装目标目录发生冲突，请重试。")
        target.parent.mkdir(parents=True, exist_ok=True)
        validate_normalized_database(
            staging / DICTIONARY_DATABASE_NAME,
            expected_adapter_id=manifest.adapter_id,
            expected_fingerprint=manifest.fingerprint,
        )
        os.replace(staging, target)
        timestamp = utc_now_iso()
        relative_path = target.relative_to(root).as_posix()
        try:
            self._repository.insert_installation(
                (
                    manifest.installation_id,
                    manifest.name,
                    manifest.adapter_id,
                    manifest.source_id,
                    manifest.source_version,
                    manifest.language,
                    relative_path,
                    manifest.fingerprint,
                    manifest.entry_count,
                    1,
                    self._repository.next_priority(),
                    manifest.model_dump_json(),
                    timestamp,
                    timestamp,
                )
            )
        except BaseException:
            rollback = (root / ".staging" / manifest.installation_id).resolve()
            rollback.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                os.replace(target, rollback)
            raise
        return manifest

    def _materialize_source(
        self,
        source: Path,
        destination: Path,
        adapter: TagDictionaryAdapter,
    ) -> tuple[Path, str]:
        destination.mkdir(parents=True, exist_ok=True)
        if source.is_file() and source.suffix.casefold() == ".zip":
            archive = destination / source.name
            digest = atomic_copy_file_with_sha256(source, archive)
            unpacked = destination / "unpacked"
            try:
                self._extract_zip(archive, unpacked)
            except (OSError, RuntimeError, zipfile.BadZipFile) as error:
                raise ValueError("所选词典压缩包无效或无法读取。") from error
            if not adapter.detect(unpacked):
                raise ValueError(f"{adapter.name} 下载包中没有受支持的词典数据。")
            return unpacked, digest

        validated = adapter.validate(source)
        payload = destination / "payload"
        payload.mkdir(parents=True, exist_ok=True)
        source_root = source if source.is_dir() else source.parent
        copied: list[tuple[str, str]] = []
        for managed in validated.managed_files:
            managed = managed.resolve()
            if not managed.is_file() or managed.is_symlink():
                raise ValueError(f"词典来源文件路径无效：{managed.name}")
            try:
                relative = managed.relative_to(source_root)
            except ValueError:
                relative = Path(managed.name)
            target = (payload / relative).resolve()
            if not target.is_relative_to(payload.resolve()):
                raise ValueError("词典来源文件包含不安全的相对路径。")
            digest = atomic_copy_file_with_sha256(managed, target)
            copied.append((relative.as_posix(), digest))
        self._copy_notices(source_root, payload)
        aggregate = hashlib.sha256()
        for relative, digest in sorted(copied):
            aggregate.update(relative.encode("utf-8"))
            aggregate.update(b"\0")
            aggregate.update(digest.encode("ascii"))
            aggregate.update(b"\n")
        return payload if source.is_dir() else payload / source.name, aggregate.hexdigest()

    @staticmethod
    def _copy_notices(source_root: Path, payload: Path) -> None:
        if not source_root.is_dir():
            return
        for name in ("LICENSE", "LICENSE.txt", "LICENSE.md", "NOTICE", "NOTICE.txt"):
            candidate = source_root / name
            if candidate.is_file() and not candidate.is_symlink():
                atomic_copy_file_with_sha256(candidate, payload / name)

    @staticmethod
    def _extract_zip(archive: Path, destination: Path) -> None:
        destination.mkdir(parents=True, exist_ok=True)
        root = destination.resolve()
        with zipfile.ZipFile(archive) as bundle:
            members = bundle.infolist()
            if len(members) > _MAX_ARCHIVE_FILES:
                raise ValueError("词典压缩包文件数量超过安全限制。")
            extracted_size = sum(member.file_size for member in members)
            if extracted_size > _MAX_ARCHIVE_BYTES:
                raise ValueError("词典压缩包解压后体积超过安全限制。")
            if shutil.disk_usage(destination.parent).free < extracted_size + _DISK_RESERVE:
                raise ValueError("词典目录可用空间不足，无法安全解压词典。")
            for member in members:
                if ":" in member.filename:
                    raise ValueError("词典压缩包包含不安全的文件名。")
                target = (root / member.filename).resolve()
                if not target.is_relative_to(root):
                    raise ValueError("词典压缩包包含不安全的路径。")
                unix_mode = member.external_attr >> 16
                if stat.S_ISLNK(unix_mode):
                    raise ValueError("词典压缩包不能包含符号链接。")
                if member.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with bundle.open(member) as source_handle, target.open("wb") as target_handle:
                    shutil.copyfileobj(source_handle, target_handle, length=1024 * 1024)

    @staticmethod
    def _require_child(root: Path, candidate: Path) -> None:
        resolved_root = root.resolve()
        if not candidate.resolve().is_relative_to(resolved_root):
            raise ValueError("词典安装路径超出受管目录。")


def _source_size(source: Path) -> int:
    if source.is_file():
        return source.stat().st_size
    return sum(
        path.stat().st_size
        for path in source.rglob("*")
        if path.is_file() and not path.is_symlink()
    )
