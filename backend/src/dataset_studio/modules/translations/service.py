from __future__ import annotations

import hashlib
import json
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING

from dataset_studio.core.errors import AssetNotFoundError
from dataset_studio.core.languages import normalize_language_code
from dataset_studio.core.sqlite import connect
from dataset_studio.modules.annotations.models import (
    AnnotationAvailabilityStatus,
    AnnotationChannel,
    AnnotationDocument,
    AnnotationStatus,
    AnnotationTag,
)
from dataset_studio.modules.annotations.projection import (
    current_usable_source_revision_sql,
    translation_dependency_revision_sql,
)
from dataset_studio.modules.annotations.repository import AnnotationRepository
from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.assets.repository import AssetRepository
from dataset_studio.modules.output_resources import (
    OutputResourceClaim,
    annotation_document_resource_key,
    hold_output_resources,
)
from dataset_studio.modules.translations.identity import (
    DEFAULT_TRANSLATION_PRODUCER_KIND,
    DEFAULT_TRANSLATION_SOURCE_KIND,
    TranslationProducerKind,
    TranslationSourceKind,
)
from dataset_studio.modules.translations.models import (
    TranslationAlignmentPart,
    TranslationAlignmentStatus,
    TranslationDictionarySource,
    TranslationDocument,
    TranslationStatus,
)
from dataset_studio.modules.translations.validation import (
    TranslationAlignmentPart as AlignmentPartData,
)
from dataset_studio.modules.translations.validation import (
    align_description_translation,
    align_tag_translation,
    parse_tag_translation_response,
)
from dataset_studio.modules.workspaces.service import WorkspaceService

if TYPE_CHECKING:
    from dataset_studio.modules.tag_dictionaries.service import TagDictionaryService

_EXPECTED_VERSION_UNSET = object()


class TranslationSourceChangedError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class TranslationSource:
    revision_id: str
    source_kind: TranslationSourceKind
    resolved_channel: AnnotationChannel
    content: str
    tags: list[AnnotationTag]
    content_hash: str

    def __iter__(self) -> Iterator[str]:
        yield self.revision_id
        yield self.content
        yield self.content_hash

    def __getitem__(self, index: int) -> str:
        return (self.revision_id, self.content, self.content_hash)[index]


class TranslationService:
    """Translation orchestration over multi-variant annotation revisions."""

    def __init__(
        self,
        workspaces: WorkspaceService,
        annotations: AnnotationService | None = None,
        tag_dictionaries: TagDictionaryService | None = None,
    ) -> None:
        self._workspaces = workspaces
        self._annotations = annotations or AnnotationService(workspaces)
        self._tag_dictionaries = tag_dictionaries

    def list(self, project_id: str, asset_id: str) -> list[TranslationDocument]:
        bundle = self._annotations.list(project_id, asset_id)
        variants = sorted(
            {
                (
                    document.language,
                    document.translation_source_kind,
                    document.translation_producer_kind,
                )
                for document in bundle.documents
                if (
                    document.channel == AnnotationChannel.TRANSLATION
                    and document.language
                    and document.translation_source_kind is not None
                    and document.translation_producer_kind is not None
                )
            },
            key=lambda item: (item[1].value, item[2].value, item[0] or ""),
        )
        return [
            self.get(
                project_id,
                asset_id,
                language or "",
                source_kind=source_kind,
                producer_kind=producer_kind,
            )
            for language, source_kind, producer_kind in variants
        ]

    def get(
        self,
        project_id: str,
        asset_id: str,
        language: str,
        *,
        source_kind: TranslationSourceKind | str = DEFAULT_TRANSLATION_SOURCE_KIND,
        producer_kind: TranslationProducerKind | str = DEFAULT_TRANSLATION_PRODUCER_KIND,
    ) -> TranslationDocument:
        language = self.normalize_language(language)
        normalized_source_kind = TranslationSourceKind(source_kind)
        normalized_producer_kind = TranslationProducerKind(producer_kind)
        document = self._annotations.get_channel(
            project_id,
            asset_id,
            AnnotationChannel.TRANSLATION,
            language,
            normalized_source_kind,
            normalized_producer_kind,
        )
        source = self.read_source_revision(
            project_id,
            asset_id,
            normalized_source_kind,
        )
        invalid_source_issue = (
            self._invalid_source_issue(project_id, asset_id, normalized_source_kind)
            if source is None
            else None
        )
        metadata = self._revision_metadata(project_id, document.head_revision_id)
        dictionary_resolution_hash = self._optional_text(metadata.get("dictionary_resolution_hash"))
        current_dictionary_resolution_hash: str | None = None
        current_dictionary_unmatched_count = 0
        dictionary_mismatch = False
        if (
            source is not None
            and normalized_source_kind == TranslationSourceKind.TAGS
            and normalized_producer_kind == TranslationProducerKind.LOCAL_DICTIONARY
            and self._tag_dictionaries is not None
        ):
            current_resolution = self._tag_dictionaries.resolve(
                [tag.name for tag in source.tags],
                language,
                categories=[tag.category for tag in source.tags],
            )
            current_dictionary_resolution_hash = current_resolution.resolution_hash
            current_dictionary_unmatched_count = current_resolution.unmatched_count
            dictionary_mismatch = bool(
                document.exists and dictionary_resolution_hash != current_dictionary_resolution_hash
            )
        if invalid_source_issue:
            status = TranslationStatus.SOURCE_INVALID
        elif source is None:
            status = TranslationStatus.SOURCE_MISSING
        elif not document.exists:
            status = TranslationStatus.MISSING
        elif document.availability_status == AnnotationAvailabilityStatus.INVALID:
            status = TranslationStatus.INVALID
        elif (
            document.availability_status == AnnotationAvailabilityStatus.STALE
            or dictionary_mismatch
        ):
            status = TranslationStatus.SOURCE_MISMATCH
        else:
            status = TranslationStatus.CURRENT

        alignment_status = TranslationAlignmentStatus.UNAVAILABLE
        alignment_parts: list[TranslationAlignmentPart] = []
        issue = invalid_source_issue
        visible_content = document.content
        if status == TranslationStatus.SOURCE_MISMATCH:
            visible_content = ""
            issue = (
                "当前不匹配：本地词典或修正词条已经变化，请重新生成对照。旧译文仅保留在历史记录中。"
                if dictionary_mismatch
                else "当前不匹配：源标注已经变化，请重新翻译。旧译文仅保留在历史记录中。"
            )
        elif source is not None and document.exists:
            valid, alignment_issue, raw_parts = self._align(
                source,
                document.content,
            )
            if valid:
                alignment_status = TranslationAlignmentStatus.ALIGNED
                alignment_parts = self._alignment_parts(raw_parts)
            else:
                alignment_status = TranslationAlignmentStatus.INVALID
                issue = alignment_issue
                status = TranslationStatus.INVALID

        dictionary_sources, dictionary_override_count = self._dictionary_provenance(metadata)
        return TranslationDocument(
            asset_id=asset_id,
            language=language,
            source_kind=normalized_source_kind,
            producer_kind=normalized_producer_kind,
            resolved_source_channel=(source.resolved_channel.value if source else None),
            path=document.path,
            exists=document.exists,
            content=visible_content,
            source_content=source.content if source else "",
            source_tags=source.tags if source else [],
            status=status,
            source_exists=source is not None,
            source_hash=self._optional_text(metadata.get("source_content_hash")),
            current_source_hash=source.content_hash if source else None,
            source_revision_id=source.revision_id if source else None,
            alignment_status=alignment_status,
            alignment_parts=alignment_parts,
            validation_status=(
                document.validation_status.value if document.validation_status else None
            ),
            provider_profile_id=self._optional_text(metadata.get("provider_profile_id")),
            provider_profile_name=self._optional_text(metadata.get("provider_profile_name")),
            model=self._optional_text(metadata.get("model")),
            dictionary_resolution_hash=dictionary_resolution_hash,
            current_dictionary_resolution_hash=current_dictionary_resolution_hash,
            dictionary_sources=dictionary_sources,
            dictionary_override_count=dictionary_override_count,
            dictionary_unmatched_count=current_dictionary_unmatched_count,
            modified_at=document.head_revision_id,
            updated_at=document.updated_at,
            issue=issue,
        )

    def read_source(
        self,
        project_id: str,
        asset_id: str,
        source_kind: TranslationSourceKind | str = DEFAULT_TRANSLATION_SOURCE_KIND,
    ) -> tuple[str, str] | None:
        source = self.read_source_revision(project_id, asset_id, source_kind)
        return (source.content, source.content_hash) if source else None

    def read_source_revision(
        self,
        project_id: str,
        asset_id: str,
        source_kind: TranslationSourceKind | str = DEFAULT_TRANSLATION_SOURCE_KIND,
    ) -> TranslationSource | None:
        normalized_source_kind = TranslationSourceKind(source_kind)
        paths, _ = self._workspaces.get(project_id)
        if AssetRepository(paths.database).get_asset(asset_id) is None:
            raise AssetNotFoundError(f"找不到素材：{asset_id}")
        repository = AnnotationRepository(paths.database)
        if normalized_source_kind == TranslationSourceKind.TAGS:
            revision_id = repository.usable_revision_id(
                asset_id,
                AnnotationChannel.TAGS,
                require_current_image=True,
            )
            if revision_id is None:
                return None
            tags = repository.revision_tags(revision_id)
            content = "\n".join(tag.name for tag in tags)
            return TranslationSource(
                revision_id=revision_id,
                source_kind=normalized_source_kind,
                resolved_channel=AnnotationChannel.TAGS,
                content=content,
                tags=tags,
                content_hash=self.tags_hash(tags),
            )
        for channel in (AnnotationChannel.DESCRIPTION, AnnotationChannel.EXISTING):
            revision_id = repository.usable_revision_id(
                asset_id,
                channel,
                require_current_image=True,
            )
            if revision_id:
                content = repository.revision_text(revision_id)
                return TranslationSource(
                    revision_id=revision_id,
                    source_kind=normalized_source_kind,
                    resolved_channel=channel,
                    content=content,
                    tags=[],
                    content_hash=self.content_hash(content),
                )
        return None

    def save_generated(
        self,
        project_id: str,
        asset_id: str,
        language: str,
        content: str,
        *,
        expected_source_hash: str,
        source_kind: TranslationSourceKind | str = DEFAULT_TRANSLATION_SOURCE_KIND,
        producer_kind: TranslationProducerKind | str = DEFAULT_TRANSLATION_PRODUCER_KIND,
        provider_profile_id: str | None = None,
        provider_profile_name: str | None = None,
        model: str | None = None,
        manually_accepted: bool = False,
        expected_modified_at: str | None | object = _EXPECTED_VERSION_UNSET,
        lease_owner_id: str | None = None,
        source_job_item_id: str | None = None,
        allow_candidate_on_conflict: bool = True,
        producer_metadata: dict[str, object] | None = None,
        content_is_normalized: bool = False,
    ) -> TranslationDocument:
        language = self.normalize_language(language)
        normalized_source_kind = TranslationSourceKind(source_kind)
        normalized_producer_kind = TranslationProducerKind(producer_kind)
        paths, _ = self._workspaces.get(project_id)
        with hold_output_resources(
            paths.database,
            self._source_claims(asset_id, normalized_source_kind),
        ):
            source = self.read_source_revision(
                project_id,
                asset_id,
                normalized_source_kind,
            )
            if source is None:
                raise TranslationSourceChangedError("源标注已不存在，未写入译文。")
            if source.content_hash != expected_source_hash:
                raise TranslationSourceChangedError("源标注在翻译期间发生变化，未写入旧译文。")

            if content_is_normalized:
                valid, validation_status, _ = self._align(source, content)
                stored_content = content
            else:
                valid, validation_status, stored_content = self._normalize_generated_content(
                    source,
                    content,
                )
            if not valid and not manually_accepted:
                raise ValueError(validation_status)
            if not valid:
                stored_content = content
            expected = (
                expected_modified_at
                if expected_modified_at is not _EXPECTED_VERSION_UNSET
                else self._annotations.head_revision_id(
                    project_id,
                    asset_id,
                    AnnotationChannel.TRANSLATION,
                    language,
                    normalized_source_kind,
                    normalized_producer_kind,
                )
            )
            self._annotations.save_generated(
                project_id,
                asset_id,
                stored_content,
                channel=AnnotationChannel.TRANSLATION,
                language=language,
                translation_source_kind=normalized_source_kind,
                translation_producer_kind=normalized_producer_kind,
                manually_accepted=manually_accepted,
                expected_modified_at=expected,
                lease_owner_id=lease_owner_id,
                source_job_item_id=source_job_item_id,
                input_revisions=((source.revision_id, "translation_source"),),
                metadata={
                    **(producer_metadata or {}),
                    "source_content_hash": source.content_hash,
                    "translation_source_kind": normalized_source_kind.value,
                    "translation_producer_kind": normalized_producer_kind.value,
                    "alignment_validation": validation_status,
                    "provider_profile_id": provider_profile_id,
                    "provider_profile_name": provider_profile_name,
                    "model": model,
                },
                allow_candidate_on_conflict=allow_candidate_on_conflict,
            )
            current = self.read_source_revision(
                project_id,
                asset_id,
                normalized_source_kind,
            )
            if current is None or current.revision_id != source.revision_id:
                raise TranslationSourceChangedError("源标注在译文提交期间发生变化，请重新翻译。")
        return self.get(
            project_id,
            asset_id,
            language,
            source_kind=normalized_source_kind,
            producer_kind=normalized_producer_kind,
        )

    def refresh_local_dictionary(
        self,
        project_id: str,
        asset_id: str,
        language: str,
        *,
        expected_source_revision_id: str,
        expected_translation_revision_id: str | None,
    ) -> TranslationDocument:
        if self._tag_dictionaries is None:
            raise ValueError("当前本地服务没有启用本地 Tag 词典模块。")
        normalized_language = self.normalize_language(language)
        with self._tag_dictionaries.catalog_guard():
            source = self.read_source_revision(
                project_id,
                asset_id,
                TranslationSourceKind.TAGS,
            )
            if source is None:
                raise TranslationSourceChangedError("源 Tags 已不存在，无法刷新本地词典译文。")
            if source.revision_id != expected_source_revision_id:
                raise TranslationSourceChangedError("源 Tags 已发生变化，请基于最新内容重试。")

            execution_profile = self._tag_dictionaries.execution_profile(normalized_language)
            if not execution_profile.sources and execution_profile.override_count == 0:
                raise ValueError("当前语言没有已启用的本地词典或修正词条。")
            resolution = self._tag_dictionaries.resolve(
                [tag.name for tag in source.tags],
                normalized_language,
                categories=[tag.category for tag in source.tags],
            )
            content = "\n".join(
                entry.translation or entry.requested_tag for entry in resolution.entries
            )
            return self.save_generated(
                project_id,
                asset_id,
                normalized_language,
                content,
                expected_source_hash=source.content_hash,
                source_kind=TranslationSourceKind.TAGS,
                producer_kind=TranslationProducerKind.LOCAL_DICTIONARY,
                expected_modified_at=expected_translation_revision_id,
                allow_candidate_on_conflict=False,
                producer_metadata={
                    "dictionary_resolution_hash": resolution.resolution_hash,
                    "dictionary_unmatched_count": resolution.unmatched_count,
                    "dictionary_entries": [
                        entry.model_dump(mode="json") for entry in resolution.entries
                    ],
                    "dictionary_execution_snapshot": execution_profile.model_dump(mode="json"),
                },
                content_is_normalized=True,
            )

    def save_manual(
        self,
        project_id: str,
        asset_id: str,
        language: str,
        content: str,
        *,
        source_kind: TranslationSourceKind | str = DEFAULT_TRANSLATION_SOURCE_KIND,
        producer_kind: TranslationProducerKind | str = DEFAULT_TRANSLATION_PRODUCER_KIND,
        expected_head_revision_id: str | None,
        review: bool = False,
    ) -> AnnotationDocument:
        language = self.normalize_language(language)
        normalized_source_kind = TranslationSourceKind(source_kind)
        normalized_producer_kind = TranslationProducerKind(producer_kind)
        if (
            normalized_producer_kind == TranslationProducerKind.LOCAL_DICTIONARY
            and normalized_source_kind == TranslationSourceKind.TAGS
        ):
            raise ValueError("本地词典译文为只读结果，请通过修正词条后重新生成。")
        paths, _ = self._workspaces.get(project_id)
        with hold_output_resources(
            paths.database,
            self._source_claims(asset_id, normalized_source_kind),
        ):
            source = self.read_source_revision(
                project_id,
                asset_id,
                normalized_source_kind,
            )
            if source is None:
                raise ValueError("当前没有可用的源标注，无法保存译文。")
            valid, validation_issue, _ = self._align(source, content)
            if not valid:
                raise ValueError(validation_issue)
            return self._annotations.save_text(
                project_id,
                asset_id,
                AnnotationChannel.TRANSLATION,
                content,
                language=language,
                translation_source_kind=normalized_source_kind,
                translation_producer_kind=normalized_producer_kind,
                source="manual_edit",
                expected_head_revision_id=expected_head_revision_id,
                review=review,
                input_revisions=((source.revision_id, "translation_source"),),
                metadata={
                    "source_content_hash": source.content_hash,
                    "translation_source_kind": normalized_source_kind.value,
                    "translation_producer_kind": normalized_producer_kind.value,
                },
            ).document

    def should_translate(
        self,
        project_id: str,
        asset_id: str,
        language: str,
        policy: str,
        *,
        source_kind: TranslationSourceKind | str = DEFAULT_TRANSLATION_SOURCE_KIND,
        producer_kind: TranslationProducerKind | str = DEFAULT_TRANSLATION_PRODUCER_KIND,
    ) -> bool:
        document = self.get(
            project_id,
            asset_id,
            language,
            source_kind=source_kind,
            producer_kind=producer_kind,
        )
        if policy == "overwrite":
            return document.source_exists
        if policy == "skip":
            return document.source_exists and not document.exists
        return document.source_exists and document.status in {
            TranslationStatus.MISSING,
            TranslationStatus.SOURCE_MISMATCH,
            TranslationStatus.INVALID,
        }

    def filter_asset_ids(
        self,
        project_id: str,
        asset_ids: Sequence[str],
        language: str,
        policy: str,
        *,
        source_kind: TranslationSourceKind | str = DEFAULT_TRANSLATION_SOURCE_KIND,
        producer_kind: TranslationProducerKind | str = DEFAULT_TRANSLATION_PRODUCER_KIND,
    ) -> list[str]:
        language = self.normalize_language(language)
        normalized_source_kind = TranslationSourceKind(source_kind)
        normalized_producer_kind = TranslationProducerKind(producer_kind)
        if policy not in {"skip", "stale", "overwrite"}:
            raise ValueError(f"不支持的现有译文策略：{policy}")
        ordered_ids = list(dict.fromkeys(asset_id for asset_id in asset_ids if asset_id))
        if not ordered_ids:
            return []
        if (
            normalized_producer_kind == TranslationProducerKind.LOCAL_DICTIONARY
            and policy == "stale"
        ):
            return [
                asset_id
                for asset_id in ordered_ids
                if self.should_translate(
                    project_id,
                    asset_id,
                    language,
                    policy,
                    source_kind=normalized_source_kind,
                    producer_kind=normalized_producer_kind,
                )
            ]
        paths, _ = self._workspaces.get(project_id)
        selected: set[str] = set()
        connection = connect(paths.database)
        try:
            for start in range(0, len(ordered_ids), 500):
                batch = ordered_ids[start : start + 500]
                placeholders = ",".join("?" for _ in batch)
                rows = connection.execute(
                    f"""
                    SELECT a.id, a.content_hash AS current_image_hash,
                           translated.head_revision_id,
                           translated_revision.is_tombstone,
                           translated_revision.image_content_hash,
                           translated_revision.validation_status,
                           {
                        current_usable_source_revision_sql(
                            asset_alias="a",
                            source_kind_sql=f"'{normalized_source_kind.value}'",
                        )
                    } AS current_source_revision_id,
                           {
                        translation_dependency_revision_sql(
                            revision_alias="translated_revision",
                        )
                    } AS dependency_revision_id
                    FROM assets a
                    LEFT JOIN annotation_documents translated
                      ON translated.asset_id = a.id
                     AND translated.channel = 'translation'
                     AND translated.language = ?
                     AND translated.translation_source_kind = ?
                     AND translated.translation_producer_kind = ?
                    LEFT JOIN annotation_document_revisions translated_revision
                      ON translated_revision.id = translated.head_revision_id
                    WHERE a.is_present = 1
                      AND a.id IN ({placeholders})
                    """,
                    [
                        language,
                        normalized_source_kind.value,
                        normalized_producer_kind.value,
                        *batch,
                    ],
                ).fetchall()
                for row in rows:
                    source_revision_id = (
                        str(row["current_source_revision_id"])
                        if row["current_source_revision_id"]
                        else None
                    )
                    if source_revision_id is None:
                        continue
                    exists = bool(row["head_revision_id"] and not bool(row["is_tombstone"]))
                    stale = bool(
                        exists
                        and (
                            str(row["image_content_hash"]) != str(row["current_image_hash"])
                            or not row["dependency_revision_id"]
                            or str(row["dependency_revision_id"]) != source_revision_id
                        )
                    )
                    invalid = bool(
                        exists
                        and str(row["validation_status"])
                        in {
                            AnnotationStatus.INVALID.value,
                            AnnotationStatus.ENCODING_ERROR.value,
                            AnnotationStatus.EMPTY.value,
                            AnnotationStatus.UNCHECKED.value,
                        }
                    )
                    if (
                        policy == "overwrite"
                        or (policy == "skip" and not exists)
                        or (policy == "stale" and (not exists or stale or invalid))
                    ):
                        selected.add(str(row["id"]))
        finally:
            connection.close()
        return [asset_id for asset_id in ordered_ids if asset_id in selected]

    def _revision_metadata(
        self,
        project_id: str,
        revision_id: str | None,
    ) -> dict[str, object]:
        if not revision_id:
            return {}
        paths, _ = self._workspaces.get(project_id)
        return AnnotationRepository(paths.database).revision_metadata(revision_id)

    @staticmethod
    def _dictionary_provenance(
        metadata: dict[str, object],
    ) -> tuple[list[TranslationDictionarySource], int]:
        raw_entries = metadata.get("dictionary_entries")
        if not isinstance(raw_entries, list):
            return [], 0
        sources: dict[str, TranslationDictionarySource] = {}
        override_count = 0
        for raw_entry in raw_entries:
            if not isinstance(raw_entry, dict):
                continue
            source_kind = str(raw_entry.get("source_kind") or "")
            if source_kind == "override":
                override_count += 1
                continue
            installation_id = str(raw_entry.get("installation_id") or "")
            if source_kind != "dictionary" or not installation_id:
                continue
            existing = sources.get(installation_id)
            if existing is not None:
                sources[installation_id] = existing.model_copy(
                    update={"matched_count": existing.matched_count + 1}
                )
                continue
            sources[installation_id] = TranslationDictionarySource(
                installation_id=installation_id,
                name=str(raw_entry.get("installation_name") or "本地词典"),
                adapter_id=TranslationService._optional_text(raw_entry.get("adapter_id")),
                source_version=TranslationService._optional_text(raw_entry.get("source_version")),
                matched_count=1,
            )
        return list(sources.values()), override_count

    def _invalid_source_issue(
        self,
        project_id: str,
        asset_id: str,
        source_kind: TranslationSourceKind,
    ) -> str | None:
        paths, _ = self._workspaces.get(project_id)
        repository = AnnotationRepository(paths.database)
        channels = (
            (AnnotationChannel.TAGS,)
            if source_kind == TranslationSourceKind.TAGS
            else (AnnotationChannel.DESCRIPTION, AnnotationChannel.EXISTING)
        )
        for channel in channels:
            revision_id = repository.head_revision_id(asset_id, channel)
            if revision_id and not repository.revision_matches_current_image(revision_id):
                return "当前源标注对应旧图片版本，请重新生成或复核后再翻译。"
            validation_status = (
                repository.revision_validation_status(revision_id) if revision_id else None
            )
            if validation_status == AnnotationStatus.ENCODING_ERROR:
                return "当前源标注不是有效的 UTF-8，修复编码后才能生成译文。"
            if validation_status in {
                AnnotationStatus.INVALID,
                AnnotationStatus.EMPTY,
                AnnotationStatus.UNCHECKED,
            }:
                return "当前源标注结构无效、为空或尚未校验，修复后才能生成译文。"
        return None

    @staticmethod
    def _normalize_generated_content(
        source: TranslationSource,
        content: str,
    ) -> tuple[bool, str, str]:
        if source.source_kind == TranslationSourceKind.TAGS:
            return parse_tag_translation_response(content, source.tags)
        valid, issue, _ = align_description_translation(source.content, content)
        return valid, issue, content

    @staticmethod
    def _align(
        source: TranslationSource,
        content: str,
    ) -> tuple[bool, str, list[AlignmentPartData]]:
        if source.source_kind == TranslationSourceKind.TAGS:
            return align_tag_translation(source.tags, content)
        return align_description_translation(source.content, content)

    @staticmethod
    def _alignment_parts(parts: list[AlignmentPartData]) -> list[TranslationAlignmentPart]:
        return [
            TranslationAlignmentPart(
                id=part.id,
                kind=part.kind,
                source_text=part.source_text,
                translated_text=part.translated_text,
                category=part.category,
                confidence=part.confidence,
            )
            for part in parts
        ]

    @staticmethod
    def content_hash(content: str) -> str:
        return hashlib.sha256(content.encode("utf-8")).hexdigest()

    @staticmethod
    def tags_hash(tags: list[AnnotationTag]) -> str:
        payload = [
            {
                "name": tag.name,
                "category": tag.category,
                "confidence": tag.confidence,
                "origin": tag.origin,
            }
            for tag in tags
        ]
        serialized = json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(serialized.encode("utf-8")).hexdigest()

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
    def _source_claims(
        asset_id: str,
        source_kind: TranslationSourceKind,
    ) -> list[OutputResourceClaim]:
        channels = (
            (AnnotationChannel.TAGS,)
            if source_kind == TranslationSourceKind.TAGS
            else (AnnotationChannel.DESCRIPTION, AnnotationChannel.EXISTING)
        )
        return [
            OutputResourceClaim(annotation_document_resource_key(asset_id, channel.value))
            for channel in channels
        ]
