from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from dataset_studio.core.errors import AssetNotFoundError
from dataset_studio.core.languages import normalize_language_code
from dataset_studio.modules.annotations.models import (
    AnnotationAvailabilityStatus,
    AnnotationBatchDeleteResult,
    AnnotationBatchOptions,
    AnnotationBatchReviewResult,
    AnnotationBatchTargetOption,
    AnnotationBundle,
    AnnotationChannel,
    AnnotationChannelTarget,
    AnnotationContentKind,
    AnnotationDocument,
    AnnotationReviewStatus,
    AnnotationRevision,
    AnnotationStatus,
    AnnotationTag,
    AnnotationWriteResult,
    ValidationIssue,
    ValidationResult,
)
from dataset_studio.modules.annotations.repository import (
    EXPECTED_HEAD_UNSET,
    AnnotationRepository,
    channel_definition,
)
from dataset_studio.modules.annotations.tag_balance import validate_tag_balance
from dataset_studio.modules.assets.repository import AssetRepository
from dataset_studio.modules.output_resources import (
    OutputResourceClaim,
    annotation_document_resource_key,
    hold_output_resources,
)
from dataset_studio.modules.workspaces.service import WorkspaceService

_EXPECTED_VERSION_UNSET = EXPECTED_HEAD_UNSET


class AnnotationService:
    def __init__(self, workspaces: WorkspaceService) -> None:
        self._workspaces = workspaces

    def list(self, project_id: str, asset_id: str) -> AnnotationBundle:
        paths, _ = self._workspaces.get(project_id)
        self._asset(paths.database, asset_id)
        repository = AnnotationRepository(paths.database)
        return AnnotationBundle(
            asset_id=asset_id,
            documents=[
                self._document(repository, row) for row in repository.list_document_rows(asset_id)
            ],
        )

    def get_channel(
        self,
        project_id: str,
        asset_id: str,
        channel: AnnotationChannel,
        language: str = "",
    ) -> AnnotationDocument:
        language = self._channel_language(channel, language)
        paths, _ = self._workspaces.get(project_id)
        asset = self._asset(paths.database, asset_id)
        repository = AnnotationRepository(paths.database)
        row = repository.get_document_row(asset_id, channel, language)
        if row is None:
            kind, display_name = channel_definition(channel, language)
            return AnnotationDocument(
                asset_id=asset_id,
                channel=channel,
                language=language or None,
                display_name=display_name,
                content_kind=kind,
                path=self._database_path_label(channel, language),
                exists=False,
                status=AnnotationStatus.MISSING,
                availability_status=AnnotationAvailabilityStatus.MISSING,
                current_image_hash=str(asset["content_hash"]),
            )
        return self._document(repository, row)

    def get(self, project_id: str, asset_id: str) -> AnnotationDocument:
        """Return the primary editable text channel for compatibility clients."""

        bundle = self.list(project_id, asset_id)
        active = {
            (document.channel, document.language or ""): document
            for document in bundle.documents
            if document.exists
        }
        for key in (
            (AnnotationChannel.DESCRIPTION, ""),
            (AnnotationChannel.EXISTING, ""),
        ):
            if key in active:
                return active[key]
        return self.get_channel(project_id, asset_id, AnnotationChannel.DESCRIPTION)

    def save(
        self,
        project_id: str,
        asset_id: str,
        content: str,
        *,
        expected_modified_at: str | None | object = _EXPECTED_VERSION_UNSET,
    ) -> AnnotationDocument:
        return self.save_text(
            project_id,
            asset_id,
            AnnotationChannel.DESCRIPTION,
            content,
            source="manual_edit",
            expected_head_revision_id=expected_modified_at,
        ).document

    def save_text(
        self,
        project_id: str,
        asset_id: str,
        channel: AnnotationChannel,
        content: str,
        *,
        language: str = "",
        source: str = "manual_edit",
        expected_head_revision_id: str | None | object = _EXPECTED_VERSION_UNSET,
        review: bool = False,
        validation_status_override: AnnotationStatus | None = None,
        lease_owner_id: str | None = None,
        source_job_item_id: str | None = None,
        input_revisions: Sequence[tuple[str, str]] = (),
        metadata: dict[str, object] | None = None,
        allow_candidate_on_conflict: bool = False,
    ) -> AnnotationWriteResult:
        if channel == AnnotationChannel.TAGS:
            raise ValueError("Tags 通道必须使用结构化 Tag 保存接口。")
        language = self._channel_language(channel, language)
        paths, _ = self._workspaces.get(project_id)
        asset = self._asset(paths.database, asset_id)
        claim = OutputResourceClaim(
            annotation_document_resource_key(asset_id, channel.value, language),
            lease_owner_id,
        )
        validation = validate_tag_balance(content)
        with hold_output_resources(paths.database, [claim]):
            write = AnnotationRepository(paths.database).write_text(
                asset_id=asset_id,
                channel=channel,
                language=language,
                content=content,
                source=source,
                validation_status=validation_status_override or validation.status,
                image_content_hash=str(asset["content_hash"]),
                expected_head_revision_id=expected_head_revision_id,
                review=review,
                source_job_item_id=source_job_item_id,
                input_revisions=input_revisions,
                metadata=metadata,
                allow_candidate_on_conflict=allow_candidate_on_conflict,
            )
        return AnnotationWriteResult(
            document=self.get_channel(project_id, asset_id, channel, language),
            revision_id=write.revision_id,
            became_head=write.became_head,
        )

    def save_tags(
        self,
        project_id: str,
        asset_id: str,
        tags: Sequence[AnnotationTag],
        *,
        source: str = "manual_edit",
        expected_head_revision_id: str | None | object = _EXPECTED_VERSION_UNSET,
        review: bool = False,
        lease_owner_id: str | None = None,
        source_job_item_id: str | None = None,
        input_revisions: Sequence[tuple[str, str]] = (),
        metadata: dict[str, object] | None = None,
        allow_candidate_on_conflict: bool = False,
    ) -> AnnotationWriteResult:
        normalized = self._normalize_tags(tags)
        paths, _ = self._workspaces.get(project_id)
        asset = self._asset(paths.database, asset_id)
        claim = OutputResourceClaim(
            annotation_document_resource_key(asset_id, AnnotationChannel.TAGS.value),
            lease_owner_id,
        )
        validation_status = AnnotationStatus.EMPTY if not normalized else AnnotationStatus.VALID
        with hold_output_resources(paths.database, [claim]):
            write = AnnotationRepository(paths.database).write_tags(
                asset_id=asset_id,
                tags=normalized,
                source=source,
                validation_status=validation_status,
                image_content_hash=str(asset["content_hash"]),
                expected_head_revision_id=expected_head_revision_id,
                review=review,
                source_job_item_id=source_job_item_id,
                input_revisions=input_revisions,
                metadata=metadata,
                allow_candidate_on_conflict=allow_candidate_on_conflict,
            )
        return AnnotationWriteResult(
            document=self.get_channel(project_id, asset_id, AnnotationChannel.TAGS),
            revision_id=write.revision_id,
            became_head=write.became_head,
        )

    def save_generated(
        self,
        project_id: str,
        asset_id: str,
        content: str,
        *,
        channel: AnnotationChannel = AnnotationChannel.DESCRIPTION,
        tags: Sequence[AnnotationTag] | None = None,
        language: str = "",
        manually_accepted: bool = False,
        expected_modified_at: str | None | object = _EXPECTED_VERSION_UNSET,
        lease_owner_id: str | None = None,
        source_job_item_id: str | None = None,
        input_revisions: Sequence[tuple[str, str]] = (),
        metadata: dict[str, object] | None = None,
        allow_candidate_on_conflict: bool = True,
    ) -> AnnotationWriteResult:
        source = (
            "manual_accept"
            if manually_accepted
            else ("local_tagger" if channel == AnnotationChannel.TAGS else "model_response")
        )
        if channel == AnnotationChannel.TAGS:
            result = self.save_tags(
                project_id,
                asset_id,
                tags or self.tags_from_content(content, origin="tagger"),
                source=source,
                expected_head_revision_id=expected_modified_at,
                review=manually_accepted,
                lease_owner_id=lease_owner_id,
                source_job_item_id=source_job_item_id,
                input_revisions=input_revisions,
                metadata=metadata,
                allow_candidate_on_conflict=allow_candidate_on_conflict,
            )
        else:
            result = self.save_text(
                project_id,
                asset_id,
                channel,
                content,
                language=language,
                source=source,
                expected_head_revision_id=expected_modified_at,
                review=manually_accepted,
                validation_status_override=(
                    AnnotationStatus.MANUALLY_ACCEPTED if manually_accepted else None
                ),
                lease_owner_id=lease_owner_id,
                source_job_item_id=source_job_item_id,
                input_revisions=input_revisions,
                metadata=metadata,
                allow_candidate_on_conflict=allow_candidate_on_conflict,
            )
        return result

    def review(
        self,
        project_id: str,
        asset_id: str,
        channel: AnnotationChannel,
        expected_head_revision_id: str,
        language: str = "",
    ) -> AnnotationDocument:
        language = self._channel_language(channel, language)
        paths, _ = self._workspaces.get(project_id)
        self._asset(paths.database, asset_id)
        claim = OutputResourceClaim(
            annotation_document_resource_key(asset_id, channel.value, language)
        )
        with hold_output_resources(paths.database, [claim]):
            AnnotationRepository(paths.database).review(
                asset_id,
                channel,
                language,
                expected_head_revision_id,
            )
        return self.get_channel(project_id, asset_id, channel, language)

    def review_tags_many(
        self,
        project_id: str,
        asset_ids: Sequence[str],
    ) -> AnnotationBatchReviewResult:
        return self.review_targets_many(
            project_id,
            asset_ids,
            [AnnotationChannelTarget(channel=AnnotationChannel.TAGS)],
        )

    def batch_options(
        self,
        project_id: str,
        asset_ids: Sequence[str],
    ) -> AnnotationBatchOptions:
        paths, _ = self._workspaces.get(project_id)
        normalized_ids = self._validated_asset_ids(paths.database, asset_ids)
        rows = AnnotationRepository(paths.database).list_document_rows_for_assets(normalized_ids)
        summaries: dict[tuple[AnnotationChannel, str], dict[str, int]] = {}
        for row in rows:
            head_revision_id = str(row["head_revision_id"]) if row["head_revision_id"] else None
            if not head_revision_id or bool(row["is_tombstone"]):
                continue
            channel = AnnotationChannel(str(row["channel"]))
            language = str(row["language"])
            summary = summaries.setdefault(
                (channel, language),
                {
                    "active_count": 0,
                    "reviewable_count": 0,
                    "reviewed_count": 0,
                    "stale_count": 0,
                },
            )
            summary["active_count"] += 1
            stale = str(row["image_content_hash"]) != str(row["current_image_hash"])
            if stale:
                summary["stale_count"] += 1
            if row["reviewed_revision_id"] == row["head_revision_id"] and not stale:
                summary["reviewed_count"] += 1
            else:
                summary["reviewable_count"] += 1

        targets = [
            AnnotationBatchTargetOption(
                channel=channel,
                language=language or None,
                display_name=channel_definition(channel, language)[1],
                **counts,
            )
            for (channel, language), counts in summaries.items()
        ]
        return AnnotationBatchOptions(
            requested_count=len(normalized_ids),
            targets=targets,
        )

    def review_targets_many(
        self,
        project_id: str,
        asset_ids: Sequence[str],
        targets: Sequence[AnnotationChannelTarget],
    ) -> AnnotationBatchReviewResult:
        selected_targets = self._validated_targets(targets)
        paths, _ = self._workspaces.get(project_id)
        normalized_ids = self._validated_asset_ids(paths.database, asset_ids)

        repository = AnnotationRepository(paths.database)
        claims = [
            OutputResourceClaim(
                annotation_document_resource_key(
                    asset_id,
                    target.channel.value,
                    target.language,
                )
            )
            for asset_id in normalized_ids
            for target in selected_targets
        ]
        with hold_output_resources(paths.database, claims):
            revisions: list[tuple[str, AnnotationChannel, str, str]] = []
            already_reviewed = 0
            missing = 0
            for target in selected_targets:
                rows = repository.get_document_rows(
                    normalized_ids,
                    target.channel,
                    target.language,
                )
                for asset_id in normalized_ids:
                    row = rows.get(asset_id)
                    if row is None or not row["head_revision_id"] or bool(row["is_tombstone"]):
                        missing += 1
                        continue
                    stale = str(row["image_content_hash"]) != str(row["current_image_hash"])
                    if row["reviewed_revision_id"] == row["head_revision_id"] and not stale:
                        already_reviewed += 1
                    else:
                        revisions.append(
                            (
                                asset_id,
                                target.channel,
                                target.language,
                                str(row["head_revision_id"]),
                            )
                        )
            repository.review_many(revisions)
        return AnnotationBatchReviewResult(
            requested_count=len(normalized_ids),
            target_count=len(selected_targets),
            reviewed_count=len(revisions),
            already_reviewed_count=already_reviewed,
            missing_count=missing,
            asset_ids=normalized_ids,
        )

    def delete(
        self,
        project_id: str,
        asset_id: str,
        channel: AnnotationChannel | None = None,
        language: str = "",
    ) -> AnnotationDocument:
        selected_channel = channel or self.get(project_id, asset_id).channel
        self.delete_many(
            project_id,
            [asset_id],
            channel=selected_channel,
            language=language,
        )
        return self.get_channel(project_id, asset_id, selected_channel, language)

    def delete_many(
        self,
        project_id: str,
        asset_ids: Sequence[str],
        *,
        channel: AnnotationChannel | None = None,
        language: str = "",
        targets: Sequence[AnnotationChannelTarget] | None = None,
    ) -> AnnotationBatchDeleteResult:
        if targets is not None and channel is not None:
            raise ValueError("批量删除不能同时使用单通道参数和多通道范围。")
        if targets is not None:
            selected_targets = self._validated_targets(targets)
        elif channel is None:
            if language:
                raise ValueError("未指定标注通道时不能指定语言。")
            selected_targets = None
        else:
            language = self._channel_language(channel, language)
            selected_targets = [AnnotationChannelTarget(channel=channel, language=language)]
        paths, _ = self._workspaces.get(project_id)
        normalized_ids = self._validated_asset_ids(paths.database, asset_ids)

        repository = AnnotationRepository(paths.database)
        if selected_targets is None:
            operations = [
                (
                    str(row["asset_id"]),
                    AnnotationChannel(str(row["channel"])),
                    str(row["language"]),
                )
                for row in repository.list_document_rows_for_assets(normalized_ids)
                if row["head_revision_id"]
                and not bool(row["is_tombstone"])
                and str(row["channel"]) != AnnotationChannel.TRANSLATION.value
            ]
        else:
            operations = [
                (asset_id, target.channel, target.language)
                for asset_id in normalized_ids
                for target in selected_targets
            ]
        claims = [
            OutputResourceClaim(
                annotation_document_resource_key(
                    asset_id,
                    target_channel.value,
                    target_language,
                )
            )
            for asset_id, target_channel, target_language in operations
        ]
        with hold_output_resources(paths.database, claims):
            deleted_targets = repository.delete_many(operations)
        deleted_asset_ids = {asset_id for asset_id, _, _ in deleted_targets}
        return AnnotationBatchDeleteResult(
            requested_count=len(normalized_ids),
            target_count=len(selected_targets) if selected_targets is not None else 0,
            deleted_count=len(deleted_targets),
            missing_count=len(normalized_ids) - len(deleted_asset_ids),
            asset_ids=normalized_ids,
        )

    def history(
        self,
        project_id: str,
        asset_id: str,
        channel: AnnotationChannel | None = None,
        language: str = "",
    ) -> list[AnnotationRevision]:
        if channel is None:
            if language:
                raise ValueError("未指定标注通道时不能指定语言。")
        else:
            language = self._channel_language(channel, language)
        paths, _ = self._workspaces.get(project_id)
        self._asset(paths.database, asset_id)
        repository = AnnotationRepository(paths.database)
        revisions: list[AnnotationRevision] = []
        for row in repository.history_rows(asset_id, channel, language):
            revision_id = str(row["id"])
            content_kind = AnnotationContentKind(str(row["content_kind"]))
            revisions.append(
                AnnotationRevision(
                    id=revision_id,
                    document_id=str(row["document_id"]),
                    channel=AnnotationChannel(str(row["channel"])),
                    language=str(row["language"]) or None,
                    source=str(row["source"]),
                    validation_status=AnnotationStatus(str(row["validation_status"])),
                    created_at=str(row["created_at"]),
                    content=(
                        repository.revision_text(revision_id)
                        if content_kind == AnnotationContentKind.TEXT
                        else self.render_tags(repository.revision_tags(revision_id))
                    ),
                    tags=(
                        repository.revision_tags(revision_id)
                        if content_kind == AnnotationContentKind.TAGS
                        else []
                    ),
                    is_tombstone=bool(row["is_tombstone"]),
                    is_candidate=bool(row["is_candidate"]),
                    image_content_hash=str(row["image_content_hash"]),
                    source_job_item_id=(
                        str(row["source_job_item_id"]) if row["source_job_item_id"] else None
                    ),
                )
            )
        return revisions

    def usable_tags(
        self,
        project_id: str,
        asset_id: str,
    ) -> tuple[str, list[AnnotationTag]] | None:
        paths, _ = self._workspaces.get(project_id)
        self._asset(paths.database, asset_id)
        repository = AnnotationRepository(paths.database)
        revision_id = repository.usable_revision_id(
            asset_id,
            AnnotationChannel.TAGS,
            require_current_image=True,
        )
        if revision_id is None:
            return None
        return revision_id, repository.revision_tags(revision_id)

    def revision_tags(self, project_id: str, revision_id: str) -> list[AnnotationTag]:
        paths, _ = self._workspaces.get(project_id)
        return AnnotationRepository(paths.database).revision_tags(revision_id)

    def head_revision_id(
        self,
        project_id: str,
        asset_id: str,
        channel: AnnotationChannel,
        language: str = "",
    ) -> str | None:
        language = self._channel_language(channel, language)
        paths, _ = self._workspaces.get(project_id)
        self._asset(paths.database, asset_id)
        return AnnotationRepository(paths.database).head_revision_id(asset_id, channel, language)

    @staticmethod
    def tags_from_content(content: str, *, origin: str) -> list[AnnotationTag]:
        return AnnotationService._normalize_tags(
            [
                AnnotationTag(name=value.strip(), origin=origin)
                for value in content.replace("\n", ",").split(",")
                if value.strip()
            ]
        )

    @staticmethod
    def render_tags(tags: Sequence[AnnotationTag]) -> str:
        return ", ".join(tag.name for tag in tags)

    @staticmethod
    def _normalize_tags(tags: Sequence[AnnotationTag]) -> list[AnnotationTag]:
        normalized: list[AnnotationTag] = []
        seen: set[str] = set()
        for tag in tags:
            key = tag.name.casefold()
            if key in seen:
                continue
            seen.add(key)
            normalized.append(tag)
        return normalized

    def _document(self, repository: AnnotationRepository, row) -> AnnotationDocument:
        channel = AnnotationChannel(str(row["channel"]))
        kind = AnnotationContentKind(str(row["content_kind"]))
        head_revision_id = str(row["head_revision_id"]) if row["head_revision_id"] else None
        reviewed_revision_id = (
            str(row["reviewed_revision_id"]) if row["reviewed_revision_id"] else None
        )
        tombstone = bool(row["is_tombstone"]) if row["is_tombstone"] is not None else False
        exists = bool(head_revision_id and not tombstone)
        content = ""
        tags: list[AnnotationTag] = []
        if exists and head_revision_id:
            if kind == AnnotationContentKind.TEXT:
                content = repository.revision_text(head_revision_id)
            else:
                tags = repository.revision_tags(head_revision_id)
                content = self.render_tags(tags)

        validation_status = (
            AnnotationStatus(str(row["validation_status"]))
            if row["validation_status"] is not None
            else None
        )
        stale = bool(
            exists
            and row["image_content_hash"]
            and str(row["image_content_hash"]) != str(row["current_image_hash"])
        )
        invalid_statuses = {
            AnnotationStatus.INVALID,
            AnnotationStatus.ENCODING_ERROR,
            AnnotationStatus.EMPTY,
            AnnotationStatus.UNCHECKED,
        }
        if not exists:
            availability_status = AnnotationAvailabilityStatus.MISSING
            review_status = None
        else:
            review_status = (
                AnnotationReviewStatus.REVIEWED
                if reviewed_revision_id == head_revision_id
                else AnnotationReviewStatus.UNREVIEWED
            )
            if stale:
                availability_status = AnnotationAvailabilityStatus.STALE
            elif validation_status in invalid_statuses:
                availability_status = AnnotationAvailabilityStatus.INVALID
            else:
                availability_status = AnnotationAvailabilityStatus.USABLE
        compatibility_status = (
            AnnotationStatus.MISSING
            if not exists
            else validation_status
            if validation_status in invalid_statuses
            else validation_status or AnnotationStatus.UNCHECKED
        )
        validation: ValidationResult | None = None
        if exists:
            validation = (
                ValidationResult(
                    valid=False,
                    status=AnnotationStatus.ENCODING_ERROR,
                    issues=[
                        ValidationIssue(
                            code="invalid_encoding",
                            message="旧 TXT 不是有效的 UTF-8；请人工修复后再复核。",
                        )
                    ],
                )
                if validation_status == AnnotationStatus.ENCODING_ERROR
                else ValidationResult(
                    valid=True,
                    status=AnnotationStatus.MANUALLY_ACCEPTED,
                )
                if validation_status == AnnotationStatus.MANUALLY_ACCEPTED
                else validate_tag_balance(content)
                if kind == AnnotationContentKind.TEXT
                else ValidationResult(
                    valid=bool(tags),
                    status=validation_status or AnnotationStatus.UNCHECKED,
                    tag_count=len(tags),
                )
            )
        return AnnotationDocument(
            asset_id=str(row["asset_id"]),
            document_id=str(row["id"]),
            channel=channel,
            language=str(row["language"]) or None,
            display_name=str(row["display_name"]),
            content_kind=kind,
            path=self._database_path_label(channel, str(row["language"])),
            exists=exists,
            content=content,
            tags=tags,
            status=compatibility_status,
            availability_status=availability_status,
            review_status=review_status,
            validation=validation,
            validation_status=validation_status,
            modified_at=head_revision_id,
            head_revision_id=head_revision_id,
            reviewed_revision_id=reviewed_revision_id,
            image_content_hash=(
                str(row["image_content_hash"]) if row["image_content_hash"] else None
            ),
            current_image_hash=str(row["current_image_hash"]),
            source=str(row["source"]) if row["source"] else None,
            updated_at=str(row["updated_at"]),
        )

    @staticmethod
    def _database_path_label(channel: AnnotationChannel, language: str) -> str:
        suffix = f":{language}" if language else ""
        return f"数据库 · {channel.value}{suffix}"

    @staticmethod
    def _channel_language(channel: AnnotationChannel, language: str) -> str:
        if channel == AnnotationChannel.TRANSLATION:
            if not language:
                raise ValueError("翻译标注通道必须指定语言。")
            try:
                return normalize_language_code(language)
            except ValueError as error:
                raise ValueError("翻译标注通道的语言代码无效。") from error
        if language:
            raise ValueError("只有翻译标注通道可以指定语言。")
        return ""

    @staticmethod
    def _asset(database_path: Path, asset_id: str):
        asset = AssetRepository(database_path).get_asset(asset_id)
        if asset is None:
            raise AssetNotFoundError(f"找不到素材：{asset_id}")
        return asset

    @staticmethod
    def _validated_asset_ids(database_path: Path, asset_ids: Sequence[str]) -> list[str]:
        normalized_ids = list(dict.fromkeys(asset_id for asset_id in asset_ids if asset_id))
        if not normalized_ids:
            raise ValueError("至少需要选择一个素材。")
        assets = AssetRepository(database_path).get_assets(normalized_ids)
        missing_assets = [asset_id for asset_id in normalized_ids if asset_id not in assets]
        if missing_assets:
            raise AssetNotFoundError(f"找不到素材：{missing_assets[0]}")
        return normalized_ids

    @staticmethod
    def _validated_targets(
        targets: Sequence[AnnotationChannelTarget],
    ) -> list[AnnotationChannelTarget]:
        selected_targets = list(targets)
        if not selected_targets:
            raise ValueError("至少需要选择一个标注通道。")
        keys = [target.key for target in selected_targets]
        if len(keys) != len(set(keys)):
            raise ValueError("同一个标注通道不能重复选择。")
        return selected_targets
