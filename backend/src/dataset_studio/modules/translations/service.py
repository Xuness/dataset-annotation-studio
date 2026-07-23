from __future__ import annotations

import hashlib
import os
import uuid
from contextlib import suppress
from pathlib import Path

from dataset_studio.core.errors import (
    AssetNotFoundError,
    FileRollbackError,
    ResourceConflictError,
)
from dataset_studio.core.files import atomic_copy_file, atomic_write_text
from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.annotations.text import (
    AnnotationEncodingError,
    read_annotation_text_strict,
)
from dataset_studio.modules.assets.repository import AssetRepository
from dataset_studio.modules.output_resources import (
    OutputResourceClaim,
    annotation_output_resource_key,
    hold_output_resources,
)
from dataset_studio.modules.translations.languages import LANGUAGE_PATTERN
from dataset_studio.modules.translations.models import (
    TranslationDocument,
    TranslationStatus,
)
from dataset_studio.modules.translations.validation import validate_translation_structure
from dataset_studio.modules.workspaces.service import WorkspaceService

_EXPECTED_VERSION_UNSET = object()


class TranslationSourceChangedError(ValueError):
    pass


class TranslationService:
    def __init__(self, workspaces: WorkspaceService) -> None:
        self._workspaces = workspaces

    def list(self, project_id: str, asset_id: str) -> list[TranslationDocument]:
        paths, _ = self._workspaces.get(project_id)
        asset = self._asset(paths.database, asset_id)
        annotation_path = self._annotation_path(paths.root, asset)
        languages = self._recorded_languages(paths.database, asset_id)
        if annotation_path.parent.is_dir():
            prefix = f"{annotation_path.stem}."
            for candidate in annotation_path.parent.glob(f"{annotation_path.stem}.*.txt"):
                name = candidate.name
                language = name[len(prefix) : -len(".txt")]
                if LANGUAGE_PATTERN.fullmatch(language):
                    languages.add(language)
        return [self.get(project_id, asset_id, language) for language in sorted(languages)]

    def get(self, project_id: str, asset_id: str, language: str) -> TranslationDocument:
        language = self.normalize_language(language)
        paths, _ = self._workspaces.get(project_id)
        asset = self._asset(paths.database, asset_id)
        annotation_path = self._annotation_path(paths.root, asset)
        translation_path = self._translation_path(annotation_path, language)
        if translation_path.is_symlink():
            raise ValueError("译文文件不能是符号链接。")
        relative_path = translation_path.relative_to(paths.root).as_posix()
        source_invalid = False
        try:
            source = self.read_source(project_id, asset_id)
        except AnnotationEncodingError:
            source = None
            source_invalid = True
        row = self._record(paths.database, asset_id, language)
        conflict = self._annotation_path_conflict(
            paths.database,
            asset_id,
            relative_path,
        )
        exists = translation_path.is_file() and not conflict

        if conflict:
            status = TranslationStatus.CONFLICT
        elif source_invalid:
            status = TranslationStatus.SOURCE_INVALID
        elif not source:
            status = TranslationStatus.SOURCE_MISSING
        elif not exists:
            status = TranslationStatus.MISSING
        elif row is None:
            status = TranslationStatus.UNTRACKED
        elif str(row["source_annotation_hash"]) != source[1]:
            status = TranslationStatus.STALE
        elif int(row["translation_modified_ns"]) != translation_path.stat().st_mtime_ns:
            status = TranslationStatus.UNTRACKED
        else:
            status = TranslationStatus.CURRENT

        return TranslationDocument(
            asset_id=asset_id,
            language=language,
            path=relative_path,
            exists=exists,
            content=(
                translation_path.read_text(encoding="utf-8", errors="replace") if exists else ""
            ),
            status=status,
            source_exists=annotation_path.is_file(),
            source_hash=str(row["source_annotation_hash"]) if row else None,
            current_source_hash=source[1] if source else None,
            validation_status=str(row["validation_status"]) if row else None,
            provider_profile_id=str(row["provider_profile_id"])
            if row and row["provider_profile_id"]
            else None,
            provider_profile_name=str(row["provider_profile_name"])
            if row and row["provider_profile_name"]
            else None,
            model=str(row["model"]) if row and row["model"] else None,
            modified_at=str(translation_path.stat().st_mtime_ns) if exists else None,
            updated_at=str(row["updated_at"]) if row else None,
            issue=(
                "目标译文路径同时是另一张图片的活动标注，已拒绝把它当作译文。"
                if conflict
                else "源标注不是有效的 UTF-8，修复编码后才能生成译文。"
                if source_invalid
                else None
            ),
        )

    def read_source(self, project_id: str, asset_id: str) -> tuple[str, str] | None:
        paths, _ = self._workspaces.get(project_id)
        asset = self._asset(paths.database, asset_id)
        annotation_path = self._annotation_path(paths.root, asset)
        if not annotation_path.is_file():
            return None
        content = read_annotation_text_strict(annotation_path)
        return content, self.content_hash(content)

    def save_generated(
        self,
        project_id: str,
        asset_id: str,
        language: str,
        content: str,
        *,
        expected_source_hash: str,
        provider_profile_id: str | None = None,
        provider_profile_name: str | None = None,
        model: str | None = None,
        manually_accepted: bool = False,
        expected_modified_at: str | None | object = _EXPECTED_VERSION_UNSET,
        lease_owner_id: str | None = None,
    ) -> TranslationDocument:
        language = self.normalize_language(language)
        paths, _ = self._workspaces.get(project_id)
        asset = self._asset(paths.database, asset_id)
        annotation_path = self._annotation_path(paths.root, asset)
        translation_path = self._translation_path(annotation_path, language)
        if translation_path.is_symlink():
            raise ValueError("译文文件不能是符号链接。")
        relative_path = translation_path.relative_to(paths.root).as_posix()
        if self._annotation_path_conflict(paths.database, asset_id, relative_path):
            raise ValueError("目标译文路径是另一张图片的活动标注，拒绝覆盖。")
        claim = OutputResourceClaim(
            annotation_output_resource_key(relative_path),
            lease_owner_id,
        )
        with hold_output_resources(paths.database, [claim]):
            return self._save_generated_locked(
                project_id,
                asset_id,
                language,
                content,
                expected_source_hash=expected_source_hash,
                provider_profile_id=provider_profile_id,
                provider_profile_name=provider_profile_name,
                model=model,
                manually_accepted=manually_accepted,
                expected_modified_at=expected_modified_at,
                database_path=paths.database,
                translation_path=translation_path,
                relative_path=relative_path,
            )

    def _save_generated_locked(
        self,
        project_id: str,
        asset_id: str,
        language: str,
        content: str,
        *,
        expected_source_hash: str,
        provider_profile_id: str | None,
        provider_profile_name: str | None,
        model: str | None,
        manually_accepted: bool,
        expected_modified_at: str | None | object,
        database_path: Path,
        translation_path: Path,
        relative_path: str,
    ) -> TranslationDocument:
        source = self._read_source_for_commit(project_id, asset_id)
        if source is None:
            raise TranslationSourceChangedError("源标注已不存在，未写入译文。")
        source_content, source_hash = source
        if source_hash != expected_source_hash:
            raise TranslationSourceChangedError("源标注在翻译期间发生变化，未写入旧译文。")

        valid, validation_status = validate_translation_structure(source_content, content)
        if not valid and not manually_accepted:
            raise ValueError(validation_status)
        if manually_accepted and not valid:
            validation_status = "manually_accepted"

        actual_modified_at = (
            str(translation_path.stat().st_mtime_ns) if translation_path.is_file() else None
        )
        if (
            expected_modified_at is not _EXPECTED_VERSION_UNSET
            and expected_modified_at != actual_modified_at
        ):
            raise ResourceConflictError("译文在任务执行期间被其他操作修改，模型结果未覆盖新内容。")
        backup: Path | None = None
        if translation_path.is_file():
            backup = translation_path.with_name(
                f".{translation_path.name}.{uuid.uuid4().hex}.backup"
            )
            atomic_copy_file(translation_path, backup)
        try:
            atomic_write_text(translation_path, content)
            current_source = self._read_source_for_commit(project_id, asset_id)
            if current_source is None or current_source[1] != source_hash:
                raise TranslationSourceChangedError("源标注在译文提交期间发生变化，未写入旧译文。")
            now = utc_now_iso()
            with transaction(database_path) as connection:
                connection.execute(
                    """
                    INSERT INTO annotation_translations (
                        asset_id, language, translation_relative_path,
                        source_annotation_hash, translation_modified_ns,
                        validation_status, provider_profile_id, provider_profile_name,
                        model, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(asset_id, language) DO UPDATE SET
                        translation_relative_path = excluded.translation_relative_path,
                        source_annotation_hash = excluded.source_annotation_hash,
                        translation_modified_ns = excluded.translation_modified_ns,
                        validation_status = excluded.validation_status,
                        provider_profile_id = excluded.provider_profile_id,
                        provider_profile_name = excluded.provider_profile_name,
                        model = excluded.model,
                        updated_at = excluded.updated_at
                    """,
                    (
                        asset_id,
                        language,
                        relative_path,
                        source_hash,
                        translation_path.stat().st_mtime_ns,
                        validation_status,
                        provider_profile_id,
                        provider_profile_name,
                        model,
                        now,
                        now,
                    ),
                )
        except BaseException as error:
            try:
                if backup is not None and backup.is_file():
                    os.replace(backup, translation_path)
                else:
                    translation_path.unlink(missing_ok=True)
            except OSError:
                raise FileRollbackError("译文写入失败，且原文件未能自动恢复。") from error
            raise
        if backup is not None:
            with suppress(OSError):
                backup.unlink(missing_ok=True)
        return self.get(project_id, asset_id, language)

    def _read_source_for_commit(
        self,
        project_id: str,
        asset_id: str,
    ) -> tuple[str, str] | None:
        try:
            return self.read_source(project_id, asset_id)
        except AnnotationEncodingError as error:
            raise TranslationSourceChangedError(
                "源标注在翻译期间变成了无效的 UTF-8，未写入旧译文。"
            ) from error

    def should_translate(
        self,
        project_id: str,
        asset_id: str,
        language: str,
        policy: str,
    ) -> bool:
        document = self.get(project_id, asset_id, language)
        if not document.source_exists or document.status == TranslationStatus.CONFLICT:
            return False
        if policy == "overwrite":
            return True
        if policy == "stale":
            return document.status in {
                TranslationStatus.MISSING,
                TranslationStatus.STALE,
                TranslationStatus.UNTRACKED,
            }
        return document.status == TranslationStatus.MISSING

    @staticmethod
    def normalize_language(language: str) -> str:
        value = language.strip()
        if not LANGUAGE_PATTERN.fullmatch(value):
            raise ValueError("语言代码必须是安全的 BCP 47 格式，例如 zh-CN、en 或 ja。")
        parts = value.split("-")
        normalized = [parts[0].lower()]
        for part in parts[1:]:
            if len(part) == 2 and part.isalpha():
                normalized.append(part.upper())
            elif len(part) == 4 and part.isalpha():
                normalized.append(part.title())
            else:
                normalized.append(part.lower())
        return "-".join(normalized)

    @staticmethod
    def content_hash(content: str) -> str:
        return hashlib.sha256(content.encode("utf-8")).hexdigest()

    @staticmethod
    def _translation_path(annotation_path: Path, language: str) -> Path:
        return annotation_path.with_name(f"{annotation_path.stem}.{language}.txt")

    @staticmethod
    def _record(database_path: Path, asset_id: str, language: str):
        connection = connect(database_path)
        try:
            return connection.execute(
                """
                SELECT * FROM annotation_translations
                WHERE asset_id = ? AND language = ?
                """,
                (asset_id, language),
            ).fetchone()
        finally:
            connection.close()

    @staticmethod
    def _recorded_languages(database_path: Path, asset_id: str) -> set[str]:
        connection = connect(database_path)
        try:
            return {
                str(row["language"])
                for row in connection.execute(
                    "SELECT language FROM annotation_translations WHERE asset_id = ?",
                    (asset_id,),
                )
            }
        finally:
            connection.close()

    @staticmethod
    def _annotation_path_conflict(
        database_path: Path,
        asset_id: str,
        relative_path: str,
    ) -> bool:
        connection = connect(database_path)
        try:
            row = connection.execute(
                """
                SELECT 1 FROM assets
                WHERE id != ? AND is_present = 1 AND annotation_relative_path = ?
                LIMIT 1
                """,
                (asset_id, relative_path),
            ).fetchone()
            return row is not None
        finally:
            connection.close()

    @staticmethod
    def _asset(database_path: Path, asset_id: str):
        asset = AssetRepository(database_path).get_asset(asset_id)
        if asset is None:
            raise AssetNotFoundError(f"找不到素材：{asset_id}")
        return asset

    @staticmethod
    def _annotation_path(root: Path, asset) -> Path:
        workspace_root = root.resolve()
        candidate = workspace_root / str(asset["annotation_relative_path"])
        if candidate.is_symlink():
            raise ValueError("标注文件不能是符号链接。")
        path = candidate.resolve()
        if not path.is_relative_to(workspace_root):
            raise AssetNotFoundError("标注路径超出当前工作区。")
        return path
