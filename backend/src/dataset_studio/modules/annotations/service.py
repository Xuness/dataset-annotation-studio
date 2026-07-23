from __future__ import annotations

import os
import uuid
from collections.abc import Sequence
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path

from dataset_studio.core.errors import AssetNotFoundError
from dataset_studio.core.files import atomic_copy_file, atomic_write_text
from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.annotations.models import (
    AnnotationBatchDeleteResult,
    AnnotationDocument,
    AnnotationRevision,
    AnnotationStatus,
    ValidationResult,
)
from dataset_studio.modules.annotations.tag_balance import validate_tag_balance
from dataset_studio.modules.annotations.text import read_annotation_text
from dataset_studio.modules.assets.repository import AssetRepository
from dataset_studio.modules.workspaces.service import WorkspaceService


@dataclass(frozen=True, slots=True)
class GeneratedAnnotation:
    asset_id: str
    content: str


@dataclass(frozen=True, slots=True)
class _PreparedAnnotation:
    asset_id: str
    content: str
    path: Path
    validation: ValidationResult


@dataclass(frozen=True, slots=True)
class _PreparedAnnotationDeletion:
    path: Path
    tombstone: Path
    owner_ids: tuple[str, ...]
    content: str
    validation: ValidationResult


class AnnotationService:
    def __init__(self, workspaces: WorkspaceService) -> None:
        self._workspaces = workspaces

    def get(self, project_id: str, asset_id: str) -> AnnotationDocument:
        paths, _ = self._workspaces.get(project_id)
        asset = self._asset(paths.database, asset_id)
        annotation_path = self._annotation_path(paths.root, asset)
        if not annotation_path.is_file():
            return AnnotationDocument(
                asset_id=asset_id,
                path=str(asset["annotation_relative_path"]),
                exists=False,
                status=AnnotationStatus.MISSING,
            )
        content, validation = read_annotation_text(annotation_path)
        status = validation.status
        if (
            status != AnnotationStatus.ENCODING_ERROR
            and str(asset["annotation_status"]) == AnnotationStatus.MANUALLY_ACCEPTED.value
            and asset["annotation_modified_ns"] is not None
            and int(asset["annotation_modified_ns"]) == annotation_path.stat().st_mtime_ns
        ):
            status = AnnotationStatus.MANUALLY_ACCEPTED
        return AnnotationDocument(
            asset_id=asset_id,
            path=str(asset["annotation_relative_path"]),
            exists=True,
            content=content,
            status=status,
            validation=validation,
            modified_at=str(annotation_path.stat().st_mtime_ns),
        )

    def save(self, project_id: str, asset_id: str, content: str) -> AnnotationDocument:
        return self._save(project_id, asset_id, content, source="manual_edit")

    def save_generated(
        self,
        project_id: str,
        asset_id: str,
        content: str,
        *,
        manually_accepted: bool = False,
    ) -> AnnotationDocument:
        return self._save(
            project_id,
            asset_id,
            content,
            source="manual_accept" if manually_accepted else "model_response",
            manually_accepted=manually_accepted,
        )

    def save_generated_batch(
        self,
        project_id: str,
        annotations: Sequence[GeneratedAnnotation],
    ) -> None:
        """Write a staged annotation batch, then commit all metadata once."""

        if not annotations:
            return
        asset_ids = [annotation.asset_id for annotation in annotations]
        if len(asset_ids) != len(set(asset_ids)):
            raise ValueError("批量保存标注时包含重复素材。")
        paths, _ = self._workspaces.get(project_id)
        placeholders = ", ".join("?" for _ in asset_ids)
        connection = connect(paths.database)
        try:
            rows = connection.execute(
                f"SELECT * FROM assets WHERE id IN ({placeholders})",
                asset_ids,
            ).fetchall()
        finally:
            connection.close()
        assets = {str(row["id"]): row for row in rows}
        missing = [asset_id for asset_id in asset_ids if asset_id not in assets]
        if missing:
            raise AssetNotFoundError(f"找不到素材：{missing[0]}")

        prepared = [
            _PreparedAnnotation(
                asset_id=annotation.asset_id,
                content=annotation.content,
                path=self._annotation_path(paths.root, assets[annotation.asset_id]),
                validation=validate_tag_balance(annotation.content),
            )
            for annotation in annotations
        ]
        backups: dict[Path, Path] = {}
        written_paths: set[Path] = set()
        modified_ns: dict[str, int] = {}
        try:
            for item in prepared:
                if item.path.is_file():
                    backup = item.path.with_name(f".{item.path.name}.{uuid.uuid4().hex}.backup")
                    atomic_copy_file(item.path, backup)
                    backups[item.path] = backup
            for item in prepared:
                atomic_write_text(item.path, item.content)
                written_paths.add(item.path)
                modified_ns[item.asset_id] = item.path.stat().st_mtime_ns
            with transaction(paths.database) as database:
                for item in prepared:
                    self._insert_revision(
                        database,
                        item.asset_id,
                        item.content,
                        source="model_response",
                        validation=item.validation,
                    )
                    self._update_annotation_status(
                        database,
                        item.asset_id,
                        item.validation.status.value,
                        modified_ns[item.asset_id],
                    )
        except BaseException as error:
            rollback_errors: list[OSError] = []
            for item in reversed(prepared):
                backup = backups.get(item.path)
                try:
                    if item.path in written_paths:
                        if backup is not None and backup.is_file():
                            os.replace(backup, item.path)
                        else:
                            item.path.unlink(missing_ok=True)
                    elif backup is not None:
                        backup.unlink(missing_ok=True)
                except OSError as rollback_error:
                    rollback_errors.append(rollback_error)
            if rollback_errors:
                raise RuntimeError(
                    f"批量标注写入失败，且有 {len(rollback_errors)} 个文件无法回滚。"
                ) from error
            raise
        for backup in backups.values():
            with suppress(OSError):
                backup.unlink(missing_ok=True)

    def _save(
        self,
        project_id: str,
        asset_id: str,
        content: str,
        *,
        source: str,
        manually_accepted: bool = False,
    ) -> AnnotationDocument:
        paths, _ = self._workspaces.get(project_id)
        asset = self._asset(paths.database, asset_id)
        annotation_path = self._annotation_path(paths.root, asset)
        validation = validate_tag_balance(content)
        backup: Path | None = None
        if annotation_path.is_file():
            backup = annotation_path.with_name(f".{annotation_path.name}.{uuid.uuid4().hex}.backup")
            atomic_copy_file(annotation_path, backup)
        status = AnnotationStatus.MANUALLY_ACCEPTED if manually_accepted else validation.status
        try:
            atomic_write_text(annotation_path, content)
            with transaction(paths.database) as connection:
                self._insert_revision(
                    connection,
                    asset_id,
                    content,
                    source=source,
                    validation=validation,
                )
                self._update_annotation_status(
                    connection,
                    asset_id,
                    status.value,
                    annotation_path.stat().st_mtime_ns,
                )
        except BaseException:
            if backup is not None and backup.is_file():
                os.replace(backup, annotation_path)
            else:
                annotation_path.unlink(missing_ok=True)
            raise
        if backup is not None:
            backup.unlink(missing_ok=True)
        document = self.get(project_id, asset_id)
        if manually_accepted:
            return document.model_copy(update={"status": AnnotationStatus.MANUALLY_ACCEPTED})
        return document

    def delete(self, project_id: str, asset_id: str) -> AnnotationDocument:
        self.delete_many(project_id, [asset_id])
        return self.get(project_id, asset_id)

    def delete_many(
        self,
        project_id: str,
        asset_ids: Sequence[str],
    ) -> AnnotationBatchDeleteResult:
        normalized_ids = list(dict.fromkeys(asset_id for asset_id in asset_ids if asset_id))
        if not normalized_ids:
            raise ValueError("至少需要选择一个素材。")
        paths, _ = self._workspaces.get(project_id)
        repository = AssetRepository(paths.database)
        assets = repository.get_assets(normalized_ids)
        missing_assets = [asset_id for asset_id in normalized_ids if asset_id not in assets]
        if missing_assets:
            raise AssetNotFoundError(f"找不到素材：{missing_assets[0]}")

        selected_ids = set(normalized_ids)
        owners_by_path: dict[str, list[str]] = {}
        for row in repository.list_present_records():
            annotation_path = self._annotation_path(paths.root, row)
            owners_by_path.setdefault(self._path_key(annotation_path), []).append(str(row["id"]))
        for asset_id in normalized_ids:
            annotation_path = self._annotation_path(paths.root, assets[asset_id])
            unselected_owners = [
                owner_id
                for owner_id in owners_by_path[self._path_key(annotation_path)]
                if owner_id not in selected_ids
            ]
            if unselected_owners and annotation_path.is_file():
                raise ValueError(
                    "所选图片与未选图片共享同一个标注文件；请同时选择这些图片后再删除标注。"
                )

        prepared: list[_PreparedAnnotationDeletion] = []
        prepared_paths: set[str] = set()
        affected_asset_ids: set[str] = set()
        try:
            for asset_id in normalized_ids:
                annotation_path = self._annotation_path(paths.root, assets[asset_id])
                path_key = self._path_key(annotation_path)
                if path_key in prepared_paths or not annotation_path.is_file():
                    continue
                previous, previous_validation = read_annotation_text(annotation_path)
                tombstone = annotation_path.with_name(
                    f".{annotation_path.name}.{uuid.uuid4().hex}.deleted"
                )
                os.replace(annotation_path, tombstone)
                owner_ids = tuple(owners_by_path[path_key])
                prepared.append(
                    _PreparedAnnotationDeletion(
                        path=annotation_path,
                        tombstone=tombstone,
                        owner_ids=owner_ids,
                        content=previous,
                        validation=previous_validation,
                    )
                )
                prepared_paths.add(path_key)
                affected_asset_ids.update(owner_ids)

            with transaction(paths.database) as connection:
                snapshots = {
                    owner_id: (item.content, item.validation)
                    for item in prepared
                    for owner_id in item.owner_ids
                }
                for asset_id in normalized_ids:
                    snapshot = snapshots.get(asset_id)
                    if snapshot is not None:
                        previous, previous_validation = snapshot
                        self._insert_revision(
                            connection,
                            asset_id,
                            previous,
                            source="deleted_snapshot",
                            validation=previous_validation,
                        )
                    self._update_annotation_status(
                        connection,
                        asset_id,
                        AnnotationStatus.MISSING.value,
                        None,
                    )
        except BaseException as error:
            rollback_errors: list[OSError] = []
            for item in reversed(prepared):
                try:
                    if item.tombstone.is_file():
                        os.replace(item.tombstone, item.path)
                except OSError as rollback_error:
                    rollback_errors.append(rollback_error)
            if rollback_errors:
                raise RuntimeError("批量删除标注失败，且部分文件未能自动恢复。") from error
            raise
        for item in prepared:
            with suppress(OSError):
                item.tombstone.unlink(missing_ok=True)
        return AnnotationBatchDeleteResult(
            requested_count=len(normalized_ids),
            deleted_count=len(affected_asset_ids),
            missing_count=len(normalized_ids) - len(affected_asset_ids),
            asset_ids=normalized_ids,
        )

    def history(self, project_id: str, asset_id: str) -> list[AnnotationRevision]:
        paths, _ = self._workspaces.get(project_id)
        self._asset(paths.database, asset_id)
        connection = connect(paths.database)
        try:
            rows = connection.execute(
                """
                SELECT id, source, validation_status, created_at, content
                FROM annotation_revisions
                WHERE asset_id = ?
                ORDER BY created_at DESC, rowid DESC
                """,
                (asset_id,),
            ).fetchall()
            return [AnnotationRevision.model_validate(dict(row)) for row in rows]
        finally:
            connection.close()

    @staticmethod
    def _insert_revision(
        connection,
        asset_id: str,
        content: str,
        *,
        source: str,
        validation: ValidationResult,
    ) -> None:
        connection.execute(
            """
            INSERT INTO annotation_revisions (
                id, asset_id, content, source, validation_status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                str(uuid.uuid4()),
                asset_id,
                content,
                source,
                validation.status.value,
                utc_now_iso(),
            ),
        )

    @staticmethod
    def _update_annotation_status(
        connection,
        asset_id: str,
        status: str,
        modified_ns: int | None,
    ) -> None:
        connection.execute(
            """
            UPDATE assets
            SET annotation_status = ?, annotation_modified_ns = ?, updated_at = ?
            WHERE id = ?
            """,
            (status, modified_ns, utc_now_iso(), asset_id),
        )

    @staticmethod
    def _asset(database_path: Path, asset_id: str):
        asset = AssetRepository(database_path).get_asset(asset_id)
        if asset is None:
            raise AssetNotFoundError(f"找不到素材：{asset_id}")
        return asset

    @staticmethod
    def _annotation_path(root: Path, asset) -> Path:
        path = (root / str(asset["annotation_relative_path"])).resolve()
        if not path.is_relative_to(root.resolve()):
            raise AssetNotFoundError("标注路径超出当前工作区。")
        return path

    @staticmethod
    def _path_key(path: Path) -> str:
        return path.resolve().as_posix().casefold()
