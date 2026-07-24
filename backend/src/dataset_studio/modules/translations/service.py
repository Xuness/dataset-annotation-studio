from __future__ import annotations

import hashlib

from dataset_studio.core.errors import AssetNotFoundError
from dataset_studio.core.languages import normalize_language_code
from dataset_studio.modules.annotations.models import (
    AnnotationChannel,
    AnnotationDocument,
    AnnotationStatus,
)
from dataset_studio.modules.annotations.repository import AnnotationRepository
from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.assets.repository import AssetRepository
from dataset_studio.modules.output_resources import (
    OutputResourceClaim,
    annotation_document_resource_key,
    hold_output_resources,
)
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
    """Translation orchestration over database-backed annotation revisions."""

    def __init__(
        self,
        workspaces: WorkspaceService,
        annotations: AnnotationService | None = None,
    ) -> None:
        self._workspaces = workspaces
        self._annotations = annotations or AnnotationService(workspaces)

    def list(self, project_id: str, asset_id: str) -> list[TranslationDocument]:
        bundle = self._annotations.list(project_id, asset_id)
        languages = sorted(
            document.language
            for document in bundle.documents
            if document.channel == AnnotationChannel.TRANSLATION and document.language
        )
        return [self.get(project_id, asset_id, language) for language in languages]

    def get(self, project_id: str, asset_id: str, language: str) -> TranslationDocument:
        language = self.normalize_language(language)
        document = self._annotations.get_channel(
            project_id,
            asset_id,
            AnnotationChannel.TRANSLATION,
            language,
        )
        source = self.read_source_revision(project_id, asset_id)
        source_revision_id = source[0] if source else None
        source_hash = source[2] if source else None
        invalid_source_issue = (
            self._invalid_source_issue(project_id, asset_id) if source is None else None
        )
        dependency_revision_id = self._translation_source_revision(
            project_id,
            document.head_revision_id,
        )

        if invalid_source_issue:
            status = TranslationStatus.SOURCE_INVALID
        elif source is None:
            status = TranslationStatus.SOURCE_MISSING
        elif not document.exists:
            status = TranslationStatus.MISSING
        elif dependency_revision_id != source_revision_id:
            status = TranslationStatus.STALE
        else:
            status = TranslationStatus.CURRENT

        metadata = self._revision_metadata(project_id, document.head_revision_id)
        return TranslationDocument(
            asset_id=asset_id,
            language=language,
            path=f"数据库 · translation:{language}",
            exists=document.exists,
            content=document.content,
            status=status,
            source_exists=source is not None,
            source_hash=self._optional_text(metadata.get("source_content_hash")),
            current_source_hash=source_hash,
            validation_status=(
                document.validation_status.value if document.validation_status else None
            ),
            provider_profile_id=self._optional_text(metadata.get("provider_profile_id")),
            provider_profile_name=self._optional_text(metadata.get("provider_profile_name")),
            model=self._optional_text(metadata.get("model")),
            modified_at=document.head_revision_id,
            updated_at=document.updated_at,
            issue=invalid_source_issue,
        )

    def read_source(self, project_id: str, asset_id: str) -> tuple[str, str] | None:
        source = self.read_source_revision(project_id, asset_id)
        return (source[1], source[2]) if source else None

    def read_source_revision(
        self,
        project_id: str,
        asset_id: str,
    ) -> tuple[str, str, str] | None:
        paths, _ = self._workspaces.get(project_id)
        if AssetRepository(paths.database).get_asset(asset_id) is None:
            raise AssetNotFoundError(f"找不到素材：{asset_id}")
        repository = AnnotationRepository(paths.database)
        for channel in (AnnotationChannel.DESCRIPTION, AnnotationChannel.EXISTING):
            revision_id = repository.confirmed_revision_id(
                asset_id,
                channel,
                require_current_image=True,
            )
            validation_status = (
                repository.revision_validation_status(revision_id) if revision_id else None
            )
            if revision_id and validation_status not in {
                None,
                AnnotationStatus.EMPTY,
                AnnotationStatus.INVALID,
                AnnotationStatus.ENCODING_ERROR,
            }:
                content = repository.revision_text(revision_id)
                return revision_id, content, self.content_hash(content)
        return None

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
        source_job_item_id: str | None = None,
        allow_candidate_on_conflict: bool = True,
    ) -> TranslationDocument:
        language = self.normalize_language(language)
        paths, _ = self._workspaces.get(project_id)
        with hold_output_resources(paths.database, self._source_claims(asset_id)):
            source = self.read_source_revision(project_id, asset_id)
            if source is None:
                raise TranslationSourceChangedError("源标注已不存在，未写入译文。")
            source_revision_id, source_content, source_hash = source
            if source_hash != expected_source_hash:
                raise TranslationSourceChangedError("源标注在翻译期间发生变化，未写入旧译文。")

            valid, validation_status = validate_translation_structure(source_content, content)
            if not valid and not manually_accepted:
                raise ValueError(validation_status)
            expected = (
                expected_modified_at
                if expected_modified_at is not _EXPECTED_VERSION_UNSET
                else self._annotations.head_revision_id(
                    project_id,
                    asset_id,
                    AnnotationChannel.TRANSLATION,
                    language,
                )
            )
            self._annotations.save_generated(
                project_id,
                asset_id,
                content,
                channel=AnnotationChannel.TRANSLATION,
                language=language,
                manually_accepted=manually_accepted,
                expected_modified_at=expected,
                lease_owner_id=lease_owner_id,
                source_job_item_id=source_job_item_id,
                input_revisions=((source_revision_id, "translation_source"),),
                metadata={
                    "source_content_hash": source_hash,
                    "provider_profile_id": provider_profile_id,
                    "provider_profile_name": provider_profile_name,
                    "model": model,
                },
                allow_candidate_on_conflict=allow_candidate_on_conflict,
            )
            current = self.read_source_revision(project_id, asset_id)
            if current is None or current[0] != source_revision_id:
                raise TranslationSourceChangedError("源标注在译文提交期间发生变化，请重新翻译。")
        return self.get(project_id, asset_id, language)

    def save_manual(
        self,
        project_id: str,
        asset_id: str,
        language: str,
        content: str,
        *,
        expected_head_revision_id: str | None,
        confirm: bool = False,
    ) -> AnnotationDocument:
        language = self.normalize_language(language)
        paths, _ = self._workspaces.get(project_id)
        with hold_output_resources(paths.database, self._source_claims(asset_id)):
            source = self.read_source_revision(project_id, asset_id)
            input_revisions: tuple[tuple[str, str], ...] = ()
            metadata: dict[str, object] = {}
            if source is not None:
                source_revision_id, _, source_hash = source
                input_revisions = ((source_revision_id, "translation_source"),)
                metadata["source_content_hash"] = source_hash
            return self._annotations.save_text(
                project_id,
                asset_id,
                AnnotationChannel.TRANSLATION,
                content,
                language=language,
                source="manual_edit",
                expected_head_revision_id=expected_head_revision_id,
                confirm=confirm,
                input_revisions=input_revisions,
                metadata=metadata,
            ).document

    def should_translate(
        self,
        project_id: str,
        asset_id: str,
        language: str,
        policy: str,
    ) -> bool:
        document = self.get(project_id, asset_id, language)
        if policy == "overwrite":
            return document.source_exists
        if policy == "skip":
            return document.source_exists and not document.exists
        return document.source_exists and document.status in {
            TranslationStatus.MISSING,
            TranslationStatus.STALE,
        }

    def _translation_source_revision(
        self,
        project_id: str,
        revision_id: str | None,
    ) -> str | None:
        if not revision_id:
            return None
        paths, _ = self._workspaces.get(project_id)
        for input_revision_id, role in AnnotationRepository(paths.database).revision_inputs(
            revision_id
        ):
            if role == "translation_source":
                return input_revision_id
        return None

    def _revision_metadata(
        self,
        project_id: str,
        revision_id: str | None,
    ) -> dict[str, object]:
        if not revision_id:
            return {}
        paths, _ = self._workspaces.get(project_id)
        return AnnotationRepository(paths.database).revision_metadata(revision_id)

    def _invalid_source_issue(self, project_id: str, asset_id: str) -> str | None:
        paths, _ = self._workspaces.get(project_id)
        repository = AnnotationRepository(paths.database)
        for channel in (AnnotationChannel.DESCRIPTION, AnnotationChannel.EXISTING):
            revision_id = repository.confirmed_revision_id(asset_id, channel)
            if revision_id and not repository.revision_matches_current_image(revision_id):
                return "已确认的源标注对应旧图片版本，重新确认当前图片的标注后才能翻译。"
            validation_status = (
                repository.revision_validation_status(revision_id) if revision_id else None
            )
            if validation_status == AnnotationStatus.ENCODING_ERROR:
                return "已确认的源标注不是有效的 UTF-8，修复编码后才能生成译文。"
            if validation_status in {AnnotationStatus.INVALID, AnnotationStatus.EMPTY}:
                return "已确认的源标注结构无效或为空，修复后才能生成译文。"
        return None

    @staticmethod
    def content_hash(content: str) -> str:
        return hashlib.sha256(content.encode("utf-8")).hexdigest()

    @staticmethod
    def normalize_language(language: str) -> str:
        try:
            return normalize_language_code(language)
        except ValueError as error:
            raise ValueError("目标语言必须是有效的语言代码，例如 zh-CN、en 或 ja。") from error

    @staticmethod
    def _optional_text(value: object) -> str | None:
        return str(value) if value is not None and str(value) else None

    @staticmethod
    def _source_claims(asset_id: str) -> list[OutputResourceClaim]:
        return [
            OutputResourceClaim(annotation_document_resource_key(asset_id, channel.value))
            for channel in (
                AnnotationChannel.DESCRIPTION,
                AnnotationChannel.EXISTING,
            )
        ]
