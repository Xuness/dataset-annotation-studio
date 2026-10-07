from __future__ import annotations

import asyncio
import csv
import sqlite3
from collections.abc import Iterator
from contextlib import closing, contextmanager
from pathlib import Path

import pytest
from PIL import Image
from pydantic import ValidationError

from dataset_studio.api.container import AppContainer
from dataset_studio.core.config import Settings
from dataset_studio.core.errors import ResourceConflictError
from dataset_studio.core.sqlite import transaction
from dataset_studio.modules.annotations.models import AnnotationChannel, AnnotationTag
from dataset_studio.modules.character_audits import repository, service
from dataset_studio.modules.character_audits.models import (
    AuditCreateRequest,
    AuditOperation,
    CharacterProfile,
    ConflictResolution,
    ModelAnswer,
    ResolutionsUpdate,
    ReviewUpdate,
    TagDecision,
    VocabularyImport,
)
from dataset_studio.modules.character_audits.rules import (
    AuditPolicyError,
    validate_decisions,
)
from dataset_studio.modules.character_audits.vocabulary import (
    VocabularyError,
    import_vocabulary,
    list_vocabularies,
    load_manifest,
    resolve_semantics,
)
from dataset_studio.modules.character_audits.worker import next_stage, process_operation
from dataset_studio.modules.presets.models import ProviderProfileCreate
from dataset_studio.modules.providers.config import (
    CodexModelOptions,
    ProviderModelConfig,
    ProviderType,
)


def write_vocabulary(directory: Path) -> None:
    directory.mkdir()
    datasets = (
        (
            "danbooru_character_tags.csv",
            ["character_tag", "post_count"],
            [[name, 20] for name in ("alpha", "beta", "gamma", "delta")],
        ),
        (
            "danbooru_dataset_general.csv",
            ["tag", "category", "parent_tag", "category_l1", "post_count"],
            [
                ["blue_hair", "general", "hair", "头发", 20],
                ["red_hair", "general", "hair", "头发", 20],
                ["white_dress", "general", "dress", "服装", 20],
                ["dress", "general", "", "服装", 20],
                ["outdoors", "general", "", "场景", 20],
                ["hair", "general", "", "头发", 20],
            ],
        ),
        (
            "danbooru_tag_near_synonyms.csv",
            ["tag", "near_synonyms"],
            [["white_dress", "dress"], ["blue_hair", "red_hair"]],
        ),
    )
    for name, header, rows in datasets:
        with (directory / name).open("w", encoding="utf-8", newline="") as stream:
            writer = csv.writer(stream)
            writer.writerow(header)
            writer.writerows(rows)


@contextmanager
def audit_context(tmp_path: Path) -> Iterator[tuple[AppContainer, str, list[str], str, str]]:
    context = AppContainer.create(Settings(app_data_dir=tmp_path / "app", host="127.0.0.1", port=0))
    root = tmp_path / "dataset"
    root.mkdir()
    for index in range(3):
        Image.new("RGB", (32, 32), (index * 70, 100, 140)).save(root / f"{index}.png")
        (root / f"{index}.txt").write_text("original companion", encoding="utf-8")
    project, _ = context.workspaces.open(str(root))
    assets = context.assets.list_assets(project.project_id).items
    ids = [asset.id for asset in assets]
    for asset_id in ids:
        context.annotations.save_tags(
            project.project_id,
            asset_id,
            [
                AnnotationTag(name="alpha", category="character", confidence=0.9, origin="tagger"),
                AnnotationTag(
                    name="blue hair", category="general", confidence=0.8, origin="tagger"
                ),
                AnnotationTag(name="outdoors", category="general", confidence=0.7, origin="tagger"),
            ],
            review=True,
        )
    provider = context.presets.create_provider(
        ProviderProfileCreate(
            name="Audit integration configuration",
            provider_type=ProviderType.CODEX,
            default_model_id="audit-model",
            models=[
                ProviderModelConfig(model_id="audit-model", protocol_options=CodexModelOptions())
            ],
        )
    )
    source = tmp_path / "source"
    write_vocabulary(source)
    vocabulary = import_vocabulary(
        context.tag_dictionaries.dictionary_root(),
        VocabularyImport(
            directory=str(source), source_version="integration-fixture", license_acknowledged=True
        ),
    )
    try:
        yield context, project.project_id, ids, provider.id, vocabulary.id
    finally:
        asyncio.run(context.aclose())


@pytest.fixture
def audit_setup(tmp_path: Path) -> Iterator[tuple[AppContainer, str, list[str], str, str]]:
    with audit_context(tmp_path) as setup:
        yield setup


def request_for(
    ids: list[str], provider_id: str, vocabulary_id: str, count: int
) -> AuditCreateRequest:
    names = ["alpha", "beta", "gamma", "delta"]
    return AuditCreateRequest(
        scope="selected",
        directory=None,
        asset_ids=ids,
        profiles=[
            CharacterProfile(
                trigger=names[index],
                reference_asset_id=ids[0],
                membership="directory",
                directory="",
                subject="unknown",
            )
            for index in range(count)
        ],
        style="sparse",
        minimum_count=1,
        provider_profile_id=provider_id,
        model_id="audit-model",
        vocabulary_id=vocabulary_id,
        retry_limit=0,
    )


def stage_review(
    context: AppContainer, project_id: str, operation: AuditOperation
) -> AuditOperation:
    reviews = []
    for review in operation.reviews:
        decisions = [
            TagDecision(
                tag=tag.tag,
                decision="replace" if tag.tag == "blue hair" else "keep",
                category=tag.category,
                reason="Reference shows red hair."
                if tag.tag == "blue hair"
                else "Protected source tag retained.",
                replacement="red hair" if tag.tag == "blue hair" else None,
                include_in_prompt=tag.tag == "blue hair",
                prompt_order=1,
            )
            for tag in review.inventory
        ]
        validate_decisions(
            decisions,
            review.inventory,
            [p.trigger for p in operation.request.profiles],
            operation.request.profiles[review.profile_index].trigger,
        )
        reviews.append(
            review.model_copy(
                update={
                    "initial": decisions,
                    "suggested": decisions,
                    "decisions": decisions,
                    "completed_stages": ["text", "visual", "resolution"],
                    "confirmed": True,
                }
            )
        )
    paths, _ = context.workspaces.get(project_id)
    return repository.save_operation(
        paths.database, operation.model_copy(update={"status": "review", "reviews": reviews})
    )


def test_real_store_atomic_apply_is_idempotent_and_review_stays_independent(audit_setup) -> None:
    context, project_id, ids, provider, vocabulary = audit_setup
    operation = service.create(context, project_id, request_for(ids, provider, vocabulary, 1))
    operation = service.start(context, project_id, operation.id, operation.version)
    operation = stage_review(context, project_id, operation)
    preview = service.preview(context, project_id, operation.id)
    assert preview.changed_count == 3
    applied = service.apply(context, project_id, operation.id, preview.preview_token)
    assert applied.status == "applied"
    assert len(applied.applied_revision_ids) == 3
    assert service.apply(context, project_id, operation.id, preview.preview_token) == applied
    paths, _ = context.workspaces.get(project_id)
    for asset_id in ids:
        document = context.annotations.get_channel(project_id, asset_id, AnnotationChannel.TAGS)
        assert [tag.name for tag in document.tags] == ["alpha", "red hair", "outdoors"]
        assert document.review_status == "unreviewed"
        assert document.tags[2].confidence == 0.7
        assert document.tags[2].origin == "tagger"
    assert (paths.root / "0.txt").read_text() == "original companion"


def test_shared_images_require_explicit_conflict_resolution(audit_setup) -> None:
    context, project_id, ids, provider, vocabulary = audit_setup
    operation = service.create(context, project_id, request_for(ids, provider, vocabulary, 2))
    operation = stage_review(
        context, project_id, service.start(context, project_id, operation.id, operation.version)
    )
    decisions = [
        item.model_copy(update={"decision": "keep", "replacement": None})
        for item in operation.reviews[1].decisions
    ]
    operation = service.save_review(
        context,
        project_id,
        operation.id,
        1,
        ReviewUpdate(version=operation.version, decisions=decisions),
    )
    preview = service.preview(context, project_id, operation.id)
    assert len(preview.conflicts) == 3
    with pytest.raises(ResourceConflictError, match="未人工裁决"):
        service.apply(context, project_id, operation.id, preview.preview_token)
    resolutions = [
        ConflictResolution(
            asset_id=conflict.asset_id,
            tag=conflict.tag,
            decision="keep",
            replacement=None,
            reason="Both characters share the scene; keep the generic source.",
        )
        for conflict in preview.conflicts
    ]
    operation = service.save_resolutions(
        context,
        project_id,
        operation.id,
        ResolutionsUpdate(version=operation.version, resolutions=resolutions),
    )
    preview = service.preview(context, project_id, operation.id)
    assert preview.changed_count == len(ids)
    for change in preview.changes:
        assert [tag.name for tag in change.after] == [*[tag.name for tag in change.before], "beta"]
    assert (
        service.apply(context, project_id, operation.id, preview.preview_token).status == "applied"
    )


def test_unchanged_input_revision_and_unindexed_image_changes_invalidate_plan(audit_setup) -> None:
    context, project_id, ids, provider, vocabulary = audit_setup
    operation = service.create(context, project_id, request_for(ids, provider, vocabulary, 1))
    operation = stage_review(
        context, project_id, service.start(context, project_id, operation.id, operation.version)
    )
    preview = service.preview(context, project_id, operation.id)
    context.annotations.save_tags(
        project_id, ids[-1], [AnnotationTag(name="alpha"), AnnotationTag(name="outdoors")]
    )
    with pytest.raises(ResourceConflictError, match="输入"):
        service.apply(context, project_id, operation.id, preview.preview_token)
    assert (
        context.annotations.get_channel(project_id, ids[0], AnnotationChannel.TAGS).tags[1].name
        == "blue hair"
    )
    fresh = service.create(context, project_id, request_for(ids, provider, vocabulary, 1))
    fresh = stage_review(
        context, project_id, service.start(context, project_id, fresh.id, fresh.version)
    )
    preview = service.preview(context, project_id, fresh.id)
    paths, _ = context.workspaces.get(project_id)
    Image.new("RGB", (32, 32), "yellow").save(paths.root / "0.png")
    with pytest.raises(ResourceConflictError, match="素材内容已变化"):
        service.apply(context, project_id, fresh.id, preview.preview_token)


def test_sqlite_failure_rolls_back_tags_and_operation_together(audit_setup) -> None:
    context, project_id, ids, provider, vocabulary = audit_setup
    operation = service.create(context, project_id, request_for(ids, provider, vocabulary, 1))
    operation = stage_review(
        context, project_id, service.start(context, project_id, operation.id, operation.version)
    )
    preview = service.preview(context, project_id, operation.id)
    paths, _ = context.workspaces.get(project_id)
    with transaction(paths.database) as connection:
        connection.execute(
            "CREATE TRIGGER fail_audit_apply BEFORE UPDATE ON character_audits "
            "WHEN NEW.status = 'applied' "
            "BEGIN SELECT RAISE(ABORT, 'integration rollback'); END"
        )
    with pytest.raises(sqlite3.IntegrityError, match="integration rollback"):
        service.apply(context, project_id, operation.id, preview.preview_token)
    assert repository.get_operation(paths.database, operation.id).status == "review"
    assert all(
        context.annotations.get_channel(project_id, asset_id, AnnotationChannel.TAGS).tags[1].name
        == "blue hair"
        for asset_id in ids
    )


def test_four_profile_resume_preserves_checkpoints_and_manual_decisions(audit_setup) -> None:
    context, project_id, ids, provider, vocabulary = audit_setup
    operation = service.create(context, project_id, request_for(ids, provider, vocabulary, 4))
    operation = stage_review(
        context, project_id, service.start(context, project_id, operation.id, operation.version)
    )
    paths, _ = context.workspaces.get(project_id)
    operation = repository.save_operation(
        paths.database, operation.model_copy(update={"status": "running"})
    )
    repository.recover_operations(paths.database)
    restored = repository.get_operation(paths.database, operation.id)
    assert restored.status == "interrupted"
    assert restored.reviews == operation.reviews
    assert all(next_stage(review) is None for review in restored.reviews)
    queued = service.start(context, project_id, operation.id, restored.version)
    claimed = repository.claim_operation(paths.database)
    assert claimed is not None and claimed.id == queued.id
    assert repository.claim_operation(paths.database) is None
    asyncio.run(process_operation(context, project_id, claimed, asyncio.Event()))
    completed = repository.get_operation(paths.database, operation.id)
    assert completed.status == "review"
    assert completed.attempts == []
    assert completed.reviews[0].decisions == restored.reviews[0].decisions
    assert all("red hair" in review.prompt for review in completed.reviews)


def test_manual_edits_reject_old_versions_and_duplicate_model_tags(audit_setup) -> None:
    context, project_id, ids, provider, vocabulary = audit_setup
    operation = service.create(context, project_id, request_for(ids, provider, vocabulary, 1))
    operation = stage_review(
        context, project_id, service.start(context, project_id, operation.id, operation.version)
    )
    request = ReviewUpdate(version=operation.version, decisions=operation.reviews[0].decisions)
    service.save_review(context, project_id, operation.id, 0, request)
    with pytest.raises(ResourceConflictError, match="版本"):
        service.save_review(context, project_id, operation.id, 0, request)
    with pytest.raises(AuditPolicyError, match="恰好覆盖"):
        validate_decisions(
            [request.decisions[0]] * 3, operation.reviews[0].inventory, ["alpha"], "alpha"
        )
    altered = [
        item.model_copy(update={"decision": "delete", "include_in_prompt": False})
        if item.tag == "outdoors"
        else item
        for item in request.decisions
    ]
    with pytest.raises(AuditPolicyError, match="不允许删除"):
        validate_decisions(altered, operation.reviews[0].inventory, ["alpha"], "alpha")
    with pytest.raises(ValidationError):
        ModelAnswer.model_validate_json('{"items": [{"tag":"alpha"}]}')
    valid = ModelAnswer.model_validate(
        {"items": [item.model_dump() for item in request.decisions], "extra": "ignored"}
    )
    assert valid.items == request.decisions


def test_missing_tags_and_empty_frequency_never_queue_model_calls(audit_setup) -> None:
    context, project_id, ids, provider, vocabulary = audit_setup
    request = request_for(ids, provider, vocabulary, 1).model_copy(update={"minimum_count": 10})
    operation = service.create(context, project_id, request)
    with pytest.raises(ValueError, match="最低出现次数"):
        service.start(context, project_id, operation.id, operation.version)
    context.annotations.save_tags(project_id, ids[0], [])
    operation = service.create(context, project_id, request_for(ids, provider, vocabulary, 1))
    with pytest.raises(ResourceConflictError, match="缺少可用 Tags"):
        service.start(context, project_id, operation.id, operation.version)
    paths, _ = context.workspaces.get(project_id)
    assert repository.get_operation(paths.database, operation.id).attempts == []
    assert service.active_count(context.workspaces) == 0


def test_vocabulary_import_is_checked_and_semantics_are_not_translations(tmp_path: Path) -> None:
    source = tmp_path / "source"
    write_vocabulary(source)
    root = tmp_path / "library"
    request = VocabularyImport(
        directory=str(source), source_version="fixture", license_acknowledged=True
    )
    manifest = import_vocabulary(root, request)
    assert import_vocabulary(root, request) == manifest
    assert (manifest.character_count, manifest.general_count, manifest.relation_count) == (4, 6, 2)
    resolved = resolve_semantics(root, manifest.id, ["white dress", "dress"])
    assert resolved["white_dress"].parents == ("dress",)
    assert "white_dress" in resolved["dress"].related
    database = root / "character-audits" / manifest.id / "semantic.sqlite3"
    with closing(sqlite3.connect(database)) as connection:
        connection.execute("UPDATE terms SET group_name = 'changed'")
        connection.commit()
    with pytest.raises(VocabularyError, match="完整性"):
        load_manifest(root, manifest.id)
    assert list_vocabularies(root).issues
    (source / "danbooru_tag_near_synonyms.csv").unlink()
    with pytest.raises(VocabularyError, match="缺少必需"):
        import_vocabulary(root, request)


def test_unattributed_input_is_still_a_staleness_dependency(audit_setup) -> None:
    context, project_id, ids, provider, vocabulary = audit_setup
    context.annotations.save_tags(project_id, ids[-1], [AnnotationTag(name="outdoors")])
    request = request_for(ids, provider, vocabulary, 1)
    request = request.model_copy(
        update={
            "profiles": [
                request.profiles[0].model_copy(update={"membership": "trigger", "directory": None})
            ]
        }
    )
    operation = service.create(context, project_id, request)
    operation = stage_review(
        context, project_id, service.start(context, project_id, operation.id, operation.version)
    )
    preview = service.preview(context, project_id, operation.id)
    assert preview.membership.unattributed_count == 1
    assert preview.changed_count == 2
    context.annotations.save_tags(
        project_id, ids[-1], [AnnotationTag(name="outdoors"), AnnotationTag(name="smile")]
    )
    with pytest.raises(ResourceConflictError, match="输入"):
        service.apply(context, project_id, operation.id, preview.preview_token)


def test_model_suggestions_do_not_implicitly_confirm_any_character(audit_setup) -> None:
    context, project_id, ids, provider, vocabulary = audit_setup
    operation = service.create(context, project_id, request_for(ids, provider, vocabulary, 1))
    operation = stage_review(
        context, project_id, service.start(context, project_id, operation.id, operation.version)
    )
    paths, _ = context.workspaces.get(project_id)
    operation = repository.save_operation(
        paths.database,
        operation.model_copy(
            update={"reviews": [operation.reviews[0].model_copy(update={"confirmed": False})]}
        ),
    )
    preview = service.preview(context, project_id, operation.id)
    with pytest.raises(ResourceConflictError, match="逐个角色确认"):
        service.apply(context, project_id, operation.id, preview.preview_token)
    operation = service.save_review(
        context,
        project_id,
        operation.id,
        0,
        ReviewUpdate(version=operation.version, decisions=operation.reviews[0].decisions),
    )
    with pytest.raises(ResourceConflictError, match="预览已过期"):
        service.apply(context, project_id, operation.id, preview.preview_token)
    preview = service.preview(context, project_id, operation.id)
    assert (
        service.apply(context, project_id, operation.id, preview.preview_token).status == "applied"
    )


def test_pending_candidates_block_until_a_newer_human_revision(audit_setup) -> None:
    context, project_id, ids, provider, vocabulary = audit_setup
    source = context.annotations.get_channel(project_id, ids[0], AnnotationChannel.TAGS)
    result = context.annotations.save_tags(
        project_id,
        ids[0],
        [AnnotationTag(name="red hair")],
        expected_head_revision_id=None,
        allow_candidate_on_conflict=True,
    )
    assert not result.became_head
    operation = service.create(context, project_id, request_for(ids, provider, vocabulary, 1))
    with pytest.raises(ResourceConflictError, match="候选结果"):
        service.start(context, project_id, operation.id, operation.version)
    context.annotations.save_tags(project_id, ids[0], source.tags)
    queued = service.start(context, project_id, operation.id, operation.version)
    assert queued.status == "queued"
    assert queued.source_assets[0].candidate_count == 0


def test_prerequisite_stop_and_failure_preserve_the_full_scope(audit_setup) -> None:
    from dataset_studio.modules.jobs.repository import JobCreation, write_job_in_transaction

    context, project_id, ids, provider, vocabulary = audit_setup
    operation = service.create(context, project_id, request_for(ids, provider, vocabulary, 1))
    paths, _ = context.workspaces.get(project_id)
    creation = JobCreation(
        job_id="completed-prerequisite",
        kind="annotation",
        configuration_snapshot="{}",
        execution_backend="provider",
        execution_profile_id=provider,
        execution_snapshot=operation.provider.model_dump_json(),
        system_preset_id="",
        system_prompt_snapshot='{"id":"","name":"test","system_prompt":"test"}',
        provider_profile_id=provider,
        provider_snapshot=operation.provider.model_dump_json(),
        user_prompt_snapshot="",
        json_fields_snapshot="[]",
        scope="selected",
        overwrite_existing=False,
        output_channel="tags",
        use_tags_as_context=False,
        output_language="",
        output_translation_source_kind="",
        output_translation_producer_kind="",
        retry_limit=0,
        asset_ids=ids,
    )
    with transaction(paths.database) as connection:
        write_job_in_transaction(connection, creation)
        connection.execute("UPDATE jobs SET status = 'completed' WHERE id = ?", (creation.job_id,))
        operation = repository.write_operation(
            connection,
            operation.model_copy(
                update={"status": "queued", "prerequisite_job_id": creation.job_id}
            ),
        )
    stopped = service.stop(context, project_id, operation.id)
    assert stopped.status == "stopped"
    assert context.jobs.get(project_id, creation.job_id).status == "completed"

    with transaction(paths.database) as connection:
        connection.execute(
            "UPDATE jobs SET status = 'completed_with_errors' WHERE id = ?", (creation.job_id,)
        )
        repository.write_operation(connection, stopped.model_copy(update={"status": "queued"}))
    claimed = repository.claim_operation(paths.database)
    assert claimed is not None
    asyncio.run(process_operation(context, project_id, claimed, asyncio.Event()))
    failed = repository.get_operation(paths.database, operation.id)
    assert failed.status == "failed"
    assert failed.error and "前置打标" in failed.error
    assert len(failed.source_assets) == len(ids)
    assert not failed.attempts


def test_semantic_namespaces_and_protected_context_rules(tmp_path: Path) -> None:
    from dataset_studio.modules.character_audits.rules import classify
    from dataset_studio.modules.character_audits.vocabulary import SemanticTag

    source = tmp_path / "source"
    write_vocabulary(source)
    with (source / "danbooru_dataset_general.csv").open(
        "a", encoding="utf-8", newline=""
    ) as stream:
        csv.writer(stream).writerow(["alpha", "general", "", "物品", 20])
    installed = import_vocabulary(
        tmp_path / "library",
        VocabularyImport(
            directory=str(source), source_version="fixture", license_acknowledged=True
        ),
    )
    semantics = resolve_semantics(tmp_path / "library", installed.id, ["alpha"])
    assert semantics["alpha"].category == "character"
    assert (
        classify(
            "hand in hair",
            SemanticTag(
                tag="hand_in_hair", category="general", group="动作", parents=(), related=()
            ),
        )
        == "action"
    )
    assert classify("holding dress", None) == "action"
    assert classify("blue eyes", None) == "eyes"


def test_subject_count_does_not_reduce_unconfirmed_extra_people(audit_setup) -> None:
    from dataset_studio.modules.character_audits.rules import build_preview

    context, project_id, ids, provider, vocabulary = audit_setup
    for asset_id in ids:
        context.annotations.save_tags(
            project_id,
            asset_id,
            [
                AnnotationTag(name="alpha"),
                AnnotationTag(name="blue hair"),
                AnnotationTag(name="3girls"),
                AnnotationTag(name="solo"),
            ],
        )
    request = request_for(ids, provider, vocabulary, 2)
    request = request.model_copy(
        update={
            "profiles": [item.model_copy(update={"subject": "girl"}) for item in request.profiles]
        }
    )
    operation = service.create(context, project_id, request)
    operation = stage_review(
        context, project_id, service.start(context, project_id, operation.id, operation.version)
    )
    preview = build_preview(operation)
    for change in preview.changes:
        names = [tag.name for tag in change.after]
        assert "3girls" in names
        assert "2girls" not in names
        assert "solo" not in names


def test_directory_trigger_and_existing_replacement_metadata_survive(audit_setup) -> None:
    context, project_id, ids, provider, vocabulary = audit_setup
    red_hair = AnnotationTag(
        name="red hair", category="general", confidence=0.97, origin="original-tagger"
    )
    for asset_id in ids:
        context.annotations.save_tags(
            project_id,
            asset_id,
            [AnnotationTag(name="blue hair"), red_hair, AnnotationTag(name="outdoors")],
        )
    operation = service.create(context, project_id, request_for(ids, provider, vocabulary, 1))
    operation = stage_review(
        context, project_id, service.start(context, project_id, operation.id, operation.version)
    )
    preview = service.preview(context, project_id, operation.id)
    service.apply(context, project_id, operation.id, preview.preview_token)
    for asset_id in ids:
        tags = context.annotations.get_channel(project_id, asset_id, AnnotationChannel.TAGS).tags
        assert next(tag for tag in tags if tag.name == "red hair") == red_hair
        assert sum(tag.name == "red hair" for tag in tags) == 1
        assert next(tag for tag in tags if tag.name == "alpha").origin == "character_audit"


def test_no_tag_change_does_not_create_new_revisions(audit_setup) -> None:
    context, project_id, ids, provider, vocabulary = audit_setup
    operation = service.create(context, project_id, request_for(ids, provider, vocabulary, 1))
    operation = stage_review(
        context, project_id, service.start(context, project_id, operation.id, operation.version)
    )
    operation = service.save_review(
        context,
        project_id,
        operation.id,
        0,
        ReviewUpdate(
            version=operation.version,
            decisions=[
                item.model_copy(update={"decision": "keep", "replacement": None})
                for item in operation.reviews[0].decisions
            ],
        ),
    )
    preview = service.preview(context, project_id, operation.id)
    assert preview.changed_count == 0
    applied = service.apply(context, project_id, operation.id, preview.preview_token)
    assert applied.status == "applied"
    assert applied.applied_revision_ids == []


def test_normalized_duplicate_triggers_and_changed_vocabulary_are_rejected(audit_setup) -> None:
    context, project_id, ids, provider, vocabulary = audit_setup
    request = request_for(ids, provider, vocabulary, 2)
    duplicate = request.model_copy(
        update={
            "profiles": [
                request.profiles[0].model_copy(update={"trigger": "alpha  beta"}),
                request.profiles[1].model_copy(update={"trigger": "ALPHA_beta"}),
            ]
        }
    )
    with pytest.raises(ValidationError, match="不同的触发词"):
        AuditCreateRequest.model_validate(duplicate.model_dump())
    operation = service.create(context, project_id, request_for(ids, provider, vocabulary, 1))
    operation = stage_review(
        context, project_id, service.start(context, project_id, operation.id, operation.version)
    )
    preview = service.preview(context, project_id, operation.id)
    index = context.tag_dictionaries.dictionary_root() / "character-audits" / vocabulary
    with (index / "semantic.sqlite3").open("ab") as stream:
        stream.write(b"changed")
    with pytest.raises(VocabularyError, match="完整性"):
        service.preview(context, project_id, operation.id)
    with pytest.raises(VocabularyError, match="完整性"):
        service.apply(context, project_id, operation.id, preview.preview_token)
