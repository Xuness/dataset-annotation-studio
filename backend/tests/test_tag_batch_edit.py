from pathlib import Path

import pytest
from PIL import Image

from dataset_studio.core.config import Settings
from dataset_studio.core.errors import ResourceConflictError
from dataset_studio.core.sqlite import connect
from dataset_studio.modules.annotations.models import (
    AnnotationChannel,
    AnnotationStatus,
    AnnotationTag,
    AnnotationTagBatchEditExecuteRequest,
    AnnotationTagBatchEditRequest,
)
from dataset_studio.modules.annotations.repository import AnnotationRepository
from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.annotations.tag_batch_edit import (
    _unmatched_tag_indices,
    build_tag_batch_edit_plan,
    to_tag_batch_edit_preview,
)
from dataset_studio.modules.assets.service import AssetService
from dataset_studio.modules.jobs.repository import JobCreationRepository
from dataset_studio.modules.output_resources import (
    OutputResourceClaim,
    annotation_document_resource_key,
    hold_output_resources,
)
from dataset_studio.modules.translations.models import TranslationStatus
from dataset_studio.modules.translations.service import TranslationService
from dataset_studio.modules.workspaces.repository import WorkspaceRegistry
from dataset_studio.modules.workspaces.service import WorkspaceService
from dataset_studio.platform.global_store import initialize_global_database


def _services(tmp_path: Path):
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    settings.ensure_directories()
    global_database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(global_database)
    workspaces = WorkspaceService(settings, WorkspaceRegistry(global_database))
    annotations = AnnotationService(workspaces)
    assets = AssetService(workspaces)
    translations = TranslationService(workspaces, annotations)
    project = tmp_path / "dataset"
    project.mkdir()
    for index in range(3):
        Image.new("RGB", (40, 40), (index * 40, 120, 180)).save(project / f"{index}.png")
    workspace, _ = workspaces.open(str(project))
    return project, workspace.project_id, assets, annotations, translations, workspaces


def _request(asset_ids: list[str], operation: dict) -> AnnotationTagBatchEditRequest:
    return AnnotationTagBatchEditRequest.model_validate(
        {"asset_ids": asset_ids, "operation": operation}
    )


def test_batch_add_replace_remove_preserves_order_and_manual_metadata(tmp_path: Path) -> None:
    _project, project_id, assets, annotations, _translations, _workspaces = _services(tmp_path)
    asset_ids = [item.id for item in assets.list_assets(project_id).items]
    annotations.save_tags(
        project_id,
        asset_ids[0],
        [
            AnnotationTag(name="old", category="character", confidence=0.8, origin="tagger"),
            AnnotationTag(name="keep", category="general", origin="manual"),
        ],
        review=True,
    )
    annotations.save_tags(
        project_id,
        asset_ids[1],
        [
            AnnotationTag(name="old", category="character", origin="tagger"),
            AnnotationTag(name="new"),
        ],
    )

    add_request = _request(
        asset_ids,
        {
            "kind": "add",
            "tags": [
                {"name": " new ", "category": "general"},
                {"name": "NEW", "category": "artist"},
                {"name": "tail", "category": None},
            ],
        },
    )
    add_preview = annotations.preview_tag_batch_edit(project_id, add_request)
    assert (add_preview.changed_count, add_preview.unchanged_count) == (3, 0)
    assert add_preview.created_or_revived_count == 1
    assert [(term.name, term.added_count) for term in add_preview.terms] == [
        ("new", 2),
        ("tail", 3),
    ]
    add_result = annotations.execute_tag_batch_edit(
        project_id,
        AnnotationTagBatchEditExecuteRequest(
            **add_request.model_dump(), preview_token=add_preview.preview_token
        ),
    )
    assert add_result.changed_asset_ids == asset_ids

    first_tags = annotations.get_channel(project_id, asset_ids[0], AnnotationChannel.TAGS).tags
    second_tags = annotations.get_channel(project_id, asset_ids[1], AnnotationChannel.TAGS).tags
    third_tags = annotations.get_channel(project_id, asset_ids[2], AnnotationChannel.TAGS).tags
    assert [tag.name for tag in first_tags] == ["old", "keep", "new", "tail"]
    assert [tag.name for tag in second_tags] == ["old", "new", "tail"]
    assert [tag.name for tag in third_tags] == ["new", "tail"]
    assert third_tags[0].category == "general"
    assert third_tags[0].confidence is None
    assert third_tags[0].origin == "manual"
    assert annotations.get_channel(project_id, asset_ids[2], AnnotationChannel.TAGS).status == (
        AnnotationStatus.VALID
    )

    replace_request = _request(
        asset_ids,
        {
            "kind": "replace",
            "source_name": " OLD ",
            "replacement": {"name": "new", "category": "copyright"},
        },
    )
    replace_preview = annotations.preview_tag_batch_edit(project_id, replace_request)
    assert (replace_preview.changed_count, replace_preview.unchanged_count) == (2, 1)
    assert [
        (term.name, term.added_count, term.removed_count) for term in replace_preview.terms
    ] == [
        ("OLD", 0, 2),
        ("new", 0, 0),
    ]
    annotations.execute_tag_batch_edit(
        project_id,
        AnnotationTagBatchEditExecuteRequest(
            **replace_request.model_dump(), preview_token=replace_preview.preview_token
        ),
    )
    assert [
        tag.name
        for tag in annotations.get_channel(project_id, asset_ids[0], AnnotationChannel.TAGS).tags
    ] == [
        "keep",
        "new",
        "tail",
    ]

    remove_request = _request(
        asset_ids,
        {"kind": "remove", "tag_names": ["KEEP", "new", "tail"]},
    )
    remove_preview = annotations.preview_tag_batch_edit(project_id, remove_request)
    assert remove_preview.changed_count == 3
    assert remove_preview.emptied_count == 3
    annotations.execute_tag_batch_edit(
        project_id,
        AnnotationTagBatchEditExecuteRequest(
            **remove_request.model_dump(), preview_token=remove_preview.preview_token
        ),
    )
    for asset_id in asset_ids:
        document = annotations.get_channel(project_id, asset_id, AnnotationChannel.TAGS)
        assert document.exists
        assert document.tags == []
        assert document.status == AnnotationStatus.EMPTY
        assert annotations.history(project_id, asset_id, AnnotationChannel.TAGS)[0].source == (
            "manual_tag_batch_remove"
        )


def test_batch_add_positions_preserve_existing_items_and_clamp_indexes(tmp_path: Path) -> None:
    _project, project_id, assets, annotations, _translations, _workspaces = _services(tmp_path)
    asset_ids = [item.id for item in assets.list_assets(project_id).items]
    annotations.save_tags(
        project_id,
        asset_ids[0],
        [AnnotationTag(name="first"), AnnotationTag(name="anchor"), AnnotationTag(name="last")],
    )
    annotations.save_tags(project_id, asset_ids[1], [AnnotationTag(name="only")])

    start_request = _request(
        asset_ids,
        {
            "kind": "add",
            "tags": [{"name": "new_a", "category": "general"}, {"name": "new_b"}],
            "position": {"kind": "start"},
        },
    )
    start_preview = annotations.preview_tag_batch_edit(project_id, start_request)
    assert (start_preview.changed_count, start_preview.position_skipped_count) == (3, 0)
    annotations.execute_tag_batch_edit(
        project_id,
        AnnotationTagBatchEditExecuteRequest(
            **start_request.model_dump(), preview_token=start_preview.preview_token
        ),
    )
    assert [
        tag.name
        for tag in annotations.get_channel(project_id, asset_ids[0], AnnotationChannel.TAGS).tags
    ] == ["new_a", "new_b", "first", "anchor", "last"]

    indexed_request = _request(
        asset_ids,
        {
            "kind": "add",
            "tags": [
                {"name": "new_b"},
                {"name": "new_c", "category": "artist"},
            ],
            "position": {"kind": "index", "index": 99},
        },
    )
    indexed_preview = annotations.preview_tag_batch_edit(project_id, indexed_request)
    assert indexed_preview.position_clamped_count == 3
    annotations.execute_tag_batch_edit(
        project_id,
        AnnotationTagBatchEditExecuteRequest(
            **indexed_request.model_dump(), preview_token=indexed_preview.preview_token
        ),
    )
    assert [
        tag.name
        for tag in annotations.get_channel(project_id, asset_ids[0], AnnotationChannel.TAGS).tags
    ] == ["new_a", "new_b", "first", "anchor", "last", "new_c"]
    assert [
        tag.name
        for tag in annotations.get_channel(project_id, asset_ids[1], AnnotationChannel.TAGS).tags
    ] == ["new_a", "new_b", "only", "new_c"]
    assert annotations.get_channel(project_id, asset_ids[2], AnnotationChannel.TAGS).tags == [
        AnnotationTag(name="new_a", category="general"),
        AnnotationTag(name="new_b"),
        AnnotationTag(name="new_c", category="artist"),
    ]


def test_batch_add_anchor_positions_skip_missing_images_and_default_to_end(tmp_path: Path) -> None:
    _project, project_id, assets, annotations, _translations, _workspaces = _services(tmp_path)
    asset_ids = [item.id for item in assets.list_assets(project_id).items]
    annotations.save_tags(
        project_id,
        asset_ids[0],
        [AnnotationTag(name="left"), AnnotationTag(name="Anchor"), AnnotationTag(name="right")],
    )
    annotations.save_tags(project_id, asset_ids[1], [AnnotationTag(name="left")])

    before_request = _request(
        asset_ids,
        {
            "kind": "add",
            "tags": [{"name": "new_one"}, {"name": "new_two"}],
            "position": {"kind": "before", "anchor_name": " anchor "},
        },
    )
    before_preview = annotations.preview_tag_batch_edit(project_id, before_request)
    assert (before_preview.changed_count, before_preview.unchanged_count) == (1, 2)
    assert before_preview.position_skipped_count == 2
    assert before_preview.position_clamped_count == 0
    annotations.execute_tag_batch_edit(
        project_id,
        AnnotationTagBatchEditExecuteRequest(
            **before_request.model_dump(), preview_token=before_preview.preview_token
        ),
    )
    assert [
        tag.name
        for tag in annotations.get_channel(project_id, asset_ids[0], AnnotationChannel.TAGS).tags
    ] == ["left", "new_one", "new_two", "Anchor", "right"]
    assert annotations.get_channel(project_id, asset_ids[2], AnnotationChannel.TAGS).exists is False

    after_request = _request(
        [asset_ids[0]],
        {
            "kind": "add",
            "tags": [{"name": "new_two"}, {"name": "after_anchor"}],
            "position": {"kind": "after", "anchor_name": "ANCHOR"},
        },
    )
    after_preview = annotations.preview_tag_batch_edit(project_id, after_request)
    assert after_preview.position_skipped_count == 0
    annotations.execute_tag_batch_edit(
        project_id,
        AnnotationTagBatchEditExecuteRequest(
            **after_request.model_dump(), preview_token=after_preview.preview_token
        ),
    )
    assert [
        tag.name
        for tag in annotations.get_channel(project_id, asset_ids[0], AnnotationChannel.TAGS).tags
    ] == ["left", "new_one", "new_two", "Anchor", "after_anchor", "right"]

    default_request = _request(
        [asset_ids[0]],
        {"kind": "add", "tags": [{"name": "tail"}]},
    )
    assert default_request.operation.position.kind == "end"
    default_preview = annotations.preview_tag_batch_edit(project_id, default_request)
    assert default_preview.preview_token != before_preview.preview_token


def test_batch_add_position_is_part_of_preview_token(tmp_path: Path) -> None:
    _project, project_id, assets, annotations, _translations, _workspaces = _services(tmp_path)
    asset_id = assets.list_assets(project_id).items[0].id
    annotations.save_tags(project_id, asset_id, [AnnotationTag(name="existing")])
    end_request = _request(
        [asset_id],
        {"kind": "add", "tags": [{"name": "new"}], "position": {"kind": "end"}},
    )
    start_request = _request(
        [asset_id],
        {"kind": "add", "tags": [{"name": "new"}], "position": {"kind": "start"}},
    )
    end_preview = annotations.preview_tag_batch_edit(project_id, end_request)
    start_preview = annotations.preview_tag_batch_edit(project_id, start_request)
    assert end_preview.preview_token != start_preview.preview_token
    with pytest.raises(ResourceConflictError, match="预览已过期"):
        annotations.execute_tag_batch_edit(
            project_id,
            AnnotationTagBatchEditExecuteRequest(
                **start_request.model_dump(), preview_token=end_preview.preview_token
            ),
        )


@pytest.mark.parametrize(
    "position",
    [
        {"kind": "index", "index": -1},
        {"kind": "before", "anchor_name": "   "},
        {"kind": "start", "unexpected": True},
        {"kind": "unknown"},
    ],
)
def test_batch_add_position_rejects_invalid_shapes(position: dict) -> None:
    with pytest.raises(ValueError):
        _request(
            ["asset"],
            {
                "kind": "add",
                "tags": [{"name": "new"}],
                "position": position,
            },
        )


def test_batch_edit_rebinds_stale_tags_and_invalidates_tag_translation(tmp_path: Path) -> None:
    project, project_id, assets, annotations, translations, workspaces = _services(tmp_path)
    asset_items = assets.list_assets(project_id).items
    asset_id = asset_items[0].id
    stale_asset_id = asset_items[1].id
    original = annotations.save_tags(
        project_id,
        asset_id,
        [AnnotationTag(name="old", category="general")],
        review=True,
    )
    paths, _ = workspaces.get(project_id)
    JobCreationRepository(paths.database).insert_job(
        job_id="frozen-job",
        kind="annotation",
        configuration_snapshot="{}",
        execution_backend="provider",
        execution_profile_id="",
        execution_snapshot="{}",
        system_preset_id="",
        system_prompt_snapshot="",
        provider_profile_id="",
        provider_snapshot="{}",
        user_prompt_snapshot="",
        json_fields_snapshot="[]",
        scope="selected",
        overwrite_existing=True,
        output_channel="description",
        use_tags_as_context=True,
        retry_limit=1,
        asset_ids=[asset_id],
    )
    annotations.save_tags(
        project_id,
        stale_asset_id,
        [AnnotationTag(name="old", category="general")],
    )
    source = translations.read_source_revision(project_id, asset_id, "tags")
    assert source is not None
    translations.save_generated(
        project_id,
        asset_id,
        "zh-CN",
        '<tags count="1"><tag index="0">旧</tag></tags>',
        expected_source_hash=source.content_hash,
        source_kind="tags",
        producer_kind="llm",
    )

    image_path = project / "1.png"
    Image.new("RGB", (40, 40), (250, 10, 10)).save(image_path)
    workspaces.rescan(project_id)
    stale = annotations.get_channel(project_id, stale_asset_id, AnnotationChannel.TAGS)
    assert stale.availability_status.value == "stale"

    request = _request(
        [asset_id, stale_asset_id],
        {"kind": "add", "tags": [{"name": "fresh", "category": "character"}]},
    )
    preview = annotations.preview_tag_batch_edit(project_id, request)
    assert preview.stale_rebound_count == 1
    assert preview.invalidated_tag_translation_count == 1
    annotations.execute_tag_batch_edit(
        project_id,
        AnnotationTagBatchEditExecuteRequest(
            **request.model_dump(), preview_token=preview.preview_token
        ),
    )
    current = annotations.get_channel(project_id, asset_id, AnnotationChannel.TAGS)
    assert current.availability_status.value == "usable"
    assert current.review_status.value == "unreviewed"
    assert current.image_content_hash == current.current_image_hash
    assert current.head_revision_id != original.revision_id
    assert annotations.history(project_id, asset_id, AnnotationChannel.TAGS)[0].source == (
        "manual_tag_batch_add"
    )
    translation = translations.get(
        project_id,
        asset_id,
        "zh-CN",
        source_kind="tags",
        producer_kind="llm",
    )
    assert translation.status == TranslationStatus.SOURCE_MISMATCH
    rebound = annotations.get_channel(project_id, stale_asset_id, AnnotationChannel.TAGS)
    assert rebound.availability_status.value == "usable"
    connection = connect(paths.database)
    try:
        frozen_revision_id = connection.execute(
            """
            SELECT frozen.revision_id
            FROM job_item_annotation_inputs frozen
            JOIN job_items item ON item.id = frozen.job_item_id
            WHERE item.job_id = 'frozen-job' AND frozen.role = 'tag_context'
            """
        ).fetchone()[0]
    finally:
        connection.close()
    assert frozen_revision_id == original.revision_id
    assert [
        tag.name for tag in AnnotationRepository(paths.database).revision_tags(frozen_revision_id)
    ] == ["old"]


def test_batch_edit_preview_token_lease_and_transaction_are_all_or_nothing(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _project, project_id, assets, annotations, _translations, workspaces = _services(tmp_path)
    asset_ids = [item.id for item in assets.list_assets(project_id).items[:2]]
    for asset_id in asset_ids:
        annotations.save_tags(project_id, asset_id, [AnnotationTag(name="old")])
    request = _request(
        asset_ids,
        {"kind": "add", "tags": [{"name": "next", "category": None}]},
    )
    preview = annotations.preview_tag_batch_edit(project_id, request)

    annotations.save_tags(project_id, asset_ids[0], [AnnotationTag(name="changed")])
    with pytest.raises(ResourceConflictError, match="预览已过期"):
        annotations.execute_tag_batch_edit(
            project_id,
            AnnotationTagBatchEditExecuteRequest(
                **request.model_dump(), preview_token=preview.preview_token
            ),
        )

    fresh_request = _request(
        asset_ids,
        {"kind": "add", "tags": [{"name": "again", "category": None}]},
    )
    fresh_preview = annotations.preview_tag_batch_edit(project_id, fresh_request)
    paths, _ = workspaces.get(project_id)
    claim = OutputResourceClaim(
        annotation_document_resource_key(asset_ids[0], AnnotationChannel.TAGS.value)
    )
    with hold_output_resources(paths.database, [claim]), pytest.raises(ResourceConflictError):
        annotations.execute_tag_batch_edit(
            project_id,
            AnnotationTagBatchEditExecuteRequest(
                **fresh_request.model_dump(), preview_token=fresh_preview.preview_token
            ),
        )

    original_write = AnnotationRepository.write_tags_in_transaction
    call_count = 0

    def fail_on_second_write(self, connection, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 2:
            raise RuntimeError("injected batch failure")
        return original_write(self, connection, **kwargs)

    monkeypatch.setattr(AnnotationRepository, "write_tags_in_transaction", fail_on_second_write)
    rollback_request = _request(
        asset_ids,
        {"kind": "add", "tags": [{"name": "rollback", "category": None}]},
    )
    rollback_preview = annotations.preview_tag_batch_edit(project_id, rollback_request)
    before_heads = {
        asset_id: annotations.head_revision_id(project_id, asset_id, AnnotationChannel.TAGS)
        for asset_id in asset_ids
    }
    with pytest.raises(RuntimeError, match="injected batch failure"):
        annotations.execute_tag_batch_edit(
            project_id,
            AnnotationTagBatchEditExecuteRequest(
                **rollback_request.model_dump(), preview_token=rollback_preview.preview_token
            ),
        )
    after_heads = {
        asset_id: annotations.head_revision_id(project_id, asset_id, AnnotationChannel.TAGS)
        for asset_id in asset_ids
    }
    assert after_heads == before_heads
    connection = connect(paths.database)
    try:
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM annotation_document_revisions "
                "WHERE source = 'manual_tag_batch_add'"
            ).fetchone()[0]
            == 0
        )
    finally:
        connection.close()


def test_batch_preview_planner_reads_multiple_revisions_in_one_shape(tmp_path: Path) -> None:
    _project, project_id, assets, annotations, _translations, workspaces = _services(tmp_path)
    asset_ids = [item.id for item in assets.list_assets(project_id).items]
    annotations.save_tags(project_id, asset_ids[0], [AnnotationTag(name="one")])
    annotations.save_tags(project_id, asset_ids[1], [AnnotationTag(name="two")])
    request = _request(
        asset_ids,
        {"kind": "remove", "tag_names": ["one", "two"]},
    )
    paths, _ = workspaces.get(project_id)
    plan = build_tag_batch_edit_plan(paths.database, request)
    preview = to_tag_batch_edit_preview(request, plan)
    assert preview.requested_count == 3
    assert preview.changed_count == 2


def test_batch_preview_details_preserve_raw_order_and_paginate_by_path(tmp_path: Path) -> None:
    _project, project_id, assets, annotations, _translations, _workspaces = _services(tmp_path)
    asset_items = assets.list_assets(project_id).items
    by_filename = {item.filename: item for item in asset_items}
    annotations.save_tags(
        project_id,
        by_filename["0.png"].id,
        [
            AnnotationTag(name="general_first", category="general"),
            AnnotationTag(name="character_second", category="character"),
            AnnotationTag(name="quality_third", category="quality"),
        ],
    )
    annotations.save_tags(
        project_id,
        by_filename["1.png"].id,
        [AnnotationTag(name="only", category="artist")],
    )
    request = _request(
        [item.id for item in reversed(asset_items)],
        {
            "kind": "add",
            "tags": [{"name": "inserted", "category": "copyright"}],
            "position": {"kind": "index", "index": 1},
        },
    )

    first_page = annotations.preview_tag_batch_edit(
        project_id,
        request,
        detail_filter="changed",
        detail_offset=0,
        detail_limit=2,
    )
    second_page = annotations.preview_tag_batch_edit(
        project_id,
        request,
        detail_filter="changed",
        detail_offset=2,
        detail_limit=2,
    )
    all_items = annotations.preview_tag_batch_edit(
        project_id,
        request,
        detail_filter="all",
        detail_limit=20,
    )
    clamped_page = annotations.preview_tag_batch_edit(
        project_id,
        request,
        detail_filter="changed",
        detail_offset=999,
        detail_limit=2,
    )

    assert (
        first_page.preview_token
        == second_page.preview_token
        == all_items.preview_token
        == clamped_page.preview_token
    )
    assert first_page.details.total == 3
    assert first_page.details.offset == 0
    assert first_page.details.limit == 2
    assert [item.filename for item in first_page.details.items] == ["0.png", "1.png"]
    first = first_page.details.items[0]
    assert first.relative_path == "0.png"
    assert first.content_version == by_filename["0.png"].content_version
    assert [tag.name for tag in first.before_tags] == [
        "general_first",
        "character_second",
        "quality_third",
    ]
    assert [tag.name for tag in first.after_tags] == [
        "general_first",
        "inserted",
        "character_second",
        "quality_third",
    ]
    assert first.added_indices == [1]
    assert first.removed_indices == []
    assert first.position_clamped is False
    assert [item.filename for item in second_page.details.items] == ["2.png"]
    assert second_page.details.items[0].before_tags == []
    assert second_page.details.items[0].added_indices == [0]
    assert all_items.details.total == 3
    assert clamped_page.details.offset == 2
    assert [item.filename for item in clamped_page.details.items] == ["2.png"]


def test_batch_preview_details_filter_position_skips_and_report_clamping(tmp_path: Path) -> None:
    _project, project_id, assets, annotations, _translations, _workspaces = _services(tmp_path)
    asset_items = assets.list_assets(project_id).items
    annotations.save_tags(
        project_id,
        asset_items[0].id,
        [AnnotationTag(name="anchor"), AnnotationTag(name="tail")],
    )
    anchor_request = _request(
        [item.id for item in asset_items],
        {
            "kind": "add",
            "tags": [{"name": "new"}],
            "position": {"kind": "before", "anchor_name": "ANCHOR"},
        },
    )

    skipped = annotations.preview_tag_batch_edit(
        project_id,
        anchor_request,
        detail_filter="position_skipped",
    )
    changed = annotations.preview_tag_batch_edit(
        project_id,
        anchor_request,
        detail_filter="changed",
    )
    assert skipped.details.total == 2
    assert all(item.position_skipped for item in skipped.details.items)
    assert all(item.before_tags == item.after_tags for item in skipped.details.items)
    assert all(
        not item.added_indices and not item.removed_indices for item in skipped.details.items
    )
    assert changed.details.total == 1
    assert changed.details.items[0].filename == "0.png"
    assert changed.details.items[0].added_indices == [0]

    clamped_request = _request(
        [asset_items[0].id],
        {
            "kind": "add",
            "tags": [{"name": "clamped"}],
            "position": {"kind": "index", "index": 99},
        },
    )
    clamped = annotations.preview_tag_batch_edit(project_id, clamped_request)
    assert clamped.details.items[0].position_clamped is True
    assert clamped.details.items[0].added_indices == [2]


def test_batch_preview_diff_indices_are_occurrence_aware() -> None:
    before = [
        AnnotationTag(name="duplicate", category="general"),
        AnnotationTag(name="keep", category="character"),
        AnnotationTag(name="DUPLICATE", category="general"),
    ]
    after = [AnnotationTag(name="keep", category="character")]

    assert _unmatched_tag_indices(before, after) == [0, 2]
    assert _unmatched_tag_indices(after, before) == []
