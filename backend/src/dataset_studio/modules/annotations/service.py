from __future__ import annotations

import os
import uuid
from pathlib import Path

from dataset_studio.core.errors import AssetNotFoundError
from dataset_studio.core.files import atomic_copy_file, atomic_write_text
from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.annotations.models import (
    AnnotationDocument,
    AnnotationRevision,
    AnnotationStatus,
    ValidationResult,
)
from dataset_studio.modules.annotations.tag_balance import validate_tag_balance
from dataset_studio.modules.assets.repository import AssetRepository
from dataset_studio.modules.workspaces.service import WorkspaceService


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
        content = annotation_path.read_text(encoding="utf-8", errors="replace")
        validation = validate_tag_balance(content)
        status = validation.status
        if (
            str(asset["annotation_status"]) == AnnotationStatus.MANUALLY_ACCEPTED.value
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
        paths, _ = self._workspaces.get(project_id)
        asset = self._asset(paths.database, asset_id)
        annotation_path = self._annotation_path(paths.root, asset)
        tombstone: Path | None = None
        previous: str | None = None
        if annotation_path.is_file():
            previous = annotation_path.read_text(encoding="utf-8", errors="replace")
            tombstone = annotation_path.with_name(
                f".{annotation_path.name}.{uuid.uuid4().hex}.deleted"
            )
            os.replace(annotation_path, tombstone)
        try:
            with transaction(paths.database) as connection:
                if previous is not None:
                    self._insert_revision(
                        connection,
                        asset_id,
                        previous,
                        source="deleted_snapshot",
                        validation=validate_tag_balance(previous),
                    )
                self._update_annotation_status(
                    connection,
                    asset_id,
                    AnnotationStatus.MISSING.value,
                    None,
                )
        except BaseException:
            if tombstone is not None and tombstone.is_file():
                os.replace(tombstone, annotation_path)
            raise
        if tombstone is not None:
            tombstone.unlink(missing_ok=True)
        return self.get(project_id, asset_id)

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
