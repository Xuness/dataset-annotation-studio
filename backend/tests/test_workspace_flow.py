from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from dataset_studio.api.app import create_app
from dataset_studio.core.config import Settings
from dataset_studio.core.errors import ResourceConflictError
from dataset_studio.core.sqlite import connect
from dataset_studio.modules.annotations.models import (
    AnnotationChannel,
    AnnotationChannelTarget,
    AnnotationTag,
)
from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.assets.repository import AssetRepository
from dataset_studio.modules.assets.service import AssetService
from dataset_studio.modules.jobs.repository import JobCreationRepository
from dataset_studio.modules.output_resources import (
    OutputResourceClaim,
    annotation_document_resource_key,
    hold_output_resources,
)
from dataset_studio.modules.taggers.models import (
    TaggerDevice,
    TaggerExecutionProfile,
    TaggerSelectionPolicy,
)
from dataset_studio.modules.translations.models import TranslationStatus
from dataset_studio.modules.translations.service import TranslationService
from dataset_studio.modules.workspaces.paths import WorkspacePaths
from dataset_studio.modules.workspaces.repository import WorkspaceRegistry
from dataset_studio.modules.workspaces.service import WorkspaceService
from dataset_studio.platform.global_store import initialize_global_database


def _services(tmp_path: Path):
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    settings.ensure_directories()
    database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(database)
    workspaces = WorkspaceService(settings, WorkspaceRegistry(database))
    return workspaces, AssetService(workspaces), AnnotationService(workspaces)


def _write_image(path: Path, size: tuple[int, int] = (80, 120)) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, color=(225, 211, 198)).save(path)


def test_workspace_is_portable_and_scans_recursive_assets(tmp_path: Path) -> None:
    workspaces, assets, _ = _services(tmp_path)
    project = tmp_path / "Character" / "Example"
    _write_image(project / "first.png")
    _write_image(project / "nested" / "second.webp", (160, 90))
    (project / "first.json").write_text('{"artist":"test"}', encoding="utf-8")
    (project / "first.txt").write_text("<caption>ready</caption>", encoding="utf-8")

    summary, scan = workspaces.open(str(project))

    assert scan.indexed_assets == 2
    assert summary.annotated_count == 1
    listed = assets.list_assets(summary.project_id)
    assert [item.relative_path for item in listed.items] == ["first.png", "nested/second.webp"]
    assert listed.items[0].metadata_relative_path == "first.json"
    assert listed.items[0].annotation_channels["existing_annotation"] == "unreviewed"

    moved = tmp_path / "Style" / "MovedExample"
    moved.parent.mkdir()
    project.rename(moved)
    reopened, _ = workspaces.open(str(moved))

    assert reopened.project_id == summary.project_id
    assert reopened.root_path == str(moved.resolve())


def test_remove_recent_api_keeps_workspace_data_and_reopen_restores_entry(
    tmp_path: Path,
) -> None:
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    project = tmp_path / "dataset"
    image = project / "sample.png"
    _write_image(image)
    paths = WorkspacePaths.from_root(project.resolve(), settings)

    with TestClient(create_app(settings)) as client:
        opened = client.post("/api/v1/workspaces/open", json={"path": str(project)})
        project_id = opened.json()["workspace"]["project_id"]
        removed = client.delete(f"/api/v1/workspaces/{project_id}/recent")

        assert opened.status_code == 200
        assert removed.status_code == 204
        assert client.get("/api/v1/workspaces").json() == []
        assert client.get(f"/api/v1/workspaces/{project_id}").status_code == 200
        assert image.is_file()
        assert paths.manifest.is_file()
        assert paths.database.is_file()

        reopened = client.post("/api/v1/workspaces/open", json={"path": str(project)})
        recent = client.get("/api/v1/workspaces").json()

    assert reopened.status_code == 200
    assert reopened.json()["workspace"]["project_id"] == project_id
    assert [workspace["project_id"] for workspace in recent] == [project_id]


def test_remove_recent_clears_idle_worker_candidates(tmp_path: Path) -> None:
    workspaces, _, _ = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "sample.png")
    workspace, _ = workspaces.open(str(project))
    workspaces.mark_worker_activity(workspace.project_id, "jobs")
    workspaces.mark_worker_activity(workspace.project_id, "exports")

    workspaces.remove_recent(workspace.project_id)

    assert workspaces.list_recent() == []
    assert workspaces.worker_candidates("jobs") == []
    assert workspaces.worker_candidates("exports") == []
    assert workspaces.get(workspace.project_id)[0].database.is_file()
    assert (project / "sample.png").is_file()


def test_annotation_channels_save_review_delete_and_keep_history_in_database(
    tmp_path: Path,
) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "image.jpg")
    summary, _ = workspaces.open(str(project))
    asset = assets.list_assets(summary.project_id).items[0]

    description = annotations.save_text(
        summary.project_id,
        asset.id,
        AnnotationChannel.DESCRIPTION,
        "<root>text</root>",
    )
    assert description.document.availability_status.value == "usable"
    assert description.document.review_status.value == "unreviewed"
    assert not (project / "image.txt").exists()
    reviewed = annotations.review(
        summary.project_id,
        asset.id,
        AnnotationChannel.DESCRIPTION,
        description.revision_id,
    )
    assert reviewed.review_status.value == "reviewed"

    tags = annotations.save_tags(
        summary.project_id,
        asset.id,
        [
            AnnotationTag(
                name="blue_hair",
                category="general",
                confidence=0.92,
                origin="local_tagger",
            ),
            AnnotationTag(name="alice", category="character", origin="manual"),
        ],
        review=True,
    )
    assert [tag.name for tag in tags.document.tags] == ["blue_hair", "alice"]
    assert tags.document.tags[0].confidence == 0.92

    bundle = annotations.list(summary.project_id, asset.id)
    assert {document.channel: document.review_status.value for document in bundle.documents} == {
        AnnotationChannel.TAGS: "reviewed",
        AnnotationChannel.DESCRIPTION: "reviewed",
    }

    deleted = annotations.delete(
        summary.project_id,
        asset.id,
        AnnotationChannel.DESCRIPTION,
    )
    assert deleted.exists is False
    assert annotations.get_channel(
        summary.project_id,
        asset.id,
        AnnotationChannel.TAGS,
    ).exists
    history = annotations.history(
        summary.project_id,
        asset.id,
        AnnotationChannel.DESCRIPTION,
    )
    assert [revision.source for revision in history] == ["manual_delete", "manual_edit"]
    assert history[0].is_tombstone


def test_tag_document_follows_nearest_local_tagger_source_through_manual_edits(
    tmp_path: Path,
) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "image.jpg")
    summary, _ = workspaces.open(str(project))
    paths, _ = workspaces.get(summary.project_id)
    asset = assets.list_assets(summary.project_id).items[0]
    profile = TaggerExecutionProfile(
        id="profile-1",
        name="CL default",
        installation_id="installation-1",
        installation_name="CL Tagger V2",
        adapter_id="cl_tagger_v2",
        model_version="v2.01a",
        fingerprint="a" * 64,
        selection=TaggerSelectionPolicy(),
        categories=["character", "general"],
        device=TaggerDevice.CPU,
        concurrency=1,
        batch_size=1,
    )
    JobCreationRepository(paths.database).insert_job(
        job_id="job-1",
        kind="annotation",
        configuration_snapshot="{}",
        execution_backend="local_tagger",
        execution_profile_id=profile.id,
        execution_snapshot=profile.model_dump_json(),
        system_preset_id="",
        system_prompt_snapshot="",
        provider_profile_id="",
        provider_snapshot="{}",
        user_prompt_snapshot="",
        json_fields_snapshot="[]",
        scope="all",
        overwrite_existing=True,
        output_channel="tags",
        use_tags_as_context=False,
        retry_limit=1,
        asset_ids=[asset.id],
    )
    connection = connect(paths.database)
    try:
        item_id = str(
            connection.execute("SELECT id FROM job_items WHERE job_id = 'job-1'").fetchone()["id"]
        )
    finally:
        connection.close()

    generated = annotations.save_generated(
        summary.project_id,
        asset.id,
        "alice, blue_hair",
        channel=AnnotationChannel.TAGS,
        tags=[
            AnnotationTag(
                name="alice",
                category="character",
                confidence=0.96,
                origin="tagger",
            ),
            AnnotationTag(
                name="blue_hair",
                category="general",
                confidence=0.91,
                origin="tagger",
            ),
        ],
        source_job_item_id=item_id,
    )
    manual = annotations.save_tags(
        summary.project_id,
        asset.id,
        [
            *generated.document.tags,
            AnnotationTag(name="smile", category=None, origin="manual"),
        ],
        expected_head_revision_id=generated.revision_id,
    )

    assert generated.document.tagger_source is not None
    assert manual.document.tagger_source is not None
    assert manual.document.tagger_source.installation_id == "installation-1"
    assert manual.document.tagger_source.fingerprint == "a" * 64

    deleted = annotations.delete(
        summary.project_id,
        asset.id,
        AnnotationChannel.TAGS,
    )
    recreated = annotations.save_tags(
        summary.project_id,
        asset.id,
        [AnnotationTag(name="manual_only", category=None, origin="manual")],
        expected_head_revision_id=deleted.head_revision_id,
    )

    assert recreated.document.tagger_source is None


def test_scan_preserves_database_annotation_written_after_scan_snapshot(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "image.png")
    summary, _ = workspaces.open(str(project))
    asset = assets.list_assets(summary.project_id).items[0]
    original_replace_scan = AssetRepository.replace_scan
    interleaved = False

    def replace_after_concurrent_save(repository, records, present_ids, annotation_baseline=None):
        nonlocal interleaved
        if not interleaved:
            interleaved = True
            annotations.save_text(
                summary.project_id,
                asset.id,
                AnnotationChannel.DESCRIPTION,
                "<caption>new</caption>",
            )
        return original_replace_scan(repository, records, present_ids, annotation_baseline)

    monkeypatch.setattr(AssetRepository, "replace_scan", replace_after_concurrent_save)
    workspaces.rescan(summary.project_id)

    current = annotations.get_channel(
        summary.project_id,
        asset.id,
        AnnotationChannel.DESCRIPTION,
    )
    assert current.content == "<caption>new</caption>"
    assert current.review_status.value == "unreviewed"
    assert not (project / "image.txt").exists()


def test_invalid_utf8_legacy_annotation_is_visible_but_not_a_translation_source(
    tmp_path: Path,
) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    translations = TranslationService(workspaces, annotations)
    project = tmp_path / "dataset"
    _write_image(project / "image.png")
    (project / "image.txt").write_bytes(b"plain-text-\xff")

    summary, _ = workspaces.open(str(project))
    asset = assets.list_assets(summary.project_id).items[0]
    document = annotations.get_channel(
        summary.project_id,
        asset.id,
        AnnotationChannel.EXISTING,
    )

    assert asset.annotation_status.value == "encoding_error"
    assert document.status.value == "encoding_error"
    assert document.availability_status.value == "invalid"
    assert document.review_status.value == "unreviewed"
    assert document.validation is not None
    assert document.validation.issues[0].code == "invalid_encoding"
    translation = translations.get(summary.project_id, asset.id, "zh-CN")
    assert translation.status == TranslationStatus.SOURCE_INVALID
    review = assets.list_assets(
        summary.project_id,
        annotation_status="needs_review",
    )
    assert [item.id for item in review.items] == [asset.id]
    assert translation.issue and "UTF-8" in translation.issue
    assert translations.read_source(summary.project_id, asset.id) is None


def test_workspace_scan_skips_broken_images_and_reports_them(tmp_path: Path) -> None:
    workspaces, assets, _ = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "valid.png")
    (project / "broken.png").write_bytes(b"not an image")

    summary, scan = workspaces.open(str(project))

    assert summary.asset_count == 1
    assert scan.scanned_files == 2
    assert scan.indexed_assets == 1
    assert scan.failed == 1
    assert scan.issues[0].path == "broken.png"
    assert [item.filename for item in assets.list_assets(summary.project_id).items] == ["valid.png"]


def test_moved_asset_keeps_reviewed_database_annotation_status(tmp_path: Path) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "before.png")
    summary, _ = workspaces.open(str(project))
    asset = assets.list_assets(summary.project_id).items[0]
    annotations.save_text(
        summary.project_id,
        asset.id,
        AnnotationChannel.DESCRIPTION,
        "<caption>accepted despite review</caption>",
        review=True,
    )

    (project / "before.png").rename(project / "after.png")
    workspaces.rescan(summary.project_id)

    moved = assets.list_assets(summary.project_id).items[0]
    assert moved.id == asset.id
    assert moved.relative_path == "after.png"
    assert moved.annotation_status.value == "valid"
    assert moved.annotation_channels["description"] == "reviewed"


def test_legacy_txt_import_is_one_time_and_preserves_the_source_file(tmp_path: Path) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "sample.png")
    source_file = project / "sample.txt"
    source_file.write_text("<caption>imported</caption>", encoding="utf-8")

    workspace, _ = workspaces.open(str(project))
    asset = assets.list_assets(workspace.project_id).items[0]
    imported = annotations.get_channel(
        workspace.project_id,
        asset.id,
        AnnotationChannel.EXISTING,
    )
    assert imported.content == "<caption>imported</caption>"
    assert imported.availability_status.value == "usable"
    assert imported.review_status.value == "unreviewed"

    paths, _ = workspaces.get(workspace.project_id)
    assert list(paths.history.glob("pre-annotation-store-v2-*.sqlite3"))
    connection = connect(paths.database)
    try:
        state = connection.execute("SELECT * FROM annotation_store_state").fetchone()
        imports = connection.execute("SELECT COUNT(*) FROM legacy_annotation_imports").fetchone()[0]
    finally:
        connection.close()
    assert state is not None and state["mode"] == "database"
    assert imports == 1

    source_file.write_text("<caption>external change</caption>", encoding="utf-8")
    workspaces.rescan(workspace.project_id)
    reopened, _ = workspaces.open(str(project))
    assert reopened.project_id == workspace.project_id
    assert (
        annotations.get_channel(
            workspace.project_id,
            asset.id,
            AnnotationChannel.EXISTING,
        ).content
        == "<caption>imported</caption>"
    )
    assert source_file.read_text(encoding="utf-8") == "<caption>external change</caption>"


def test_legacy_translation_language_is_canonicalized_once(tmp_path: Path) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "sample.png")
    (project / "sample.txt").write_text("<caption>source</caption>", encoding="utf-8")
    (project / "sample.zh-cn.txt").write_text("<caption>译文</caption>", encoding="utf-8")

    workspace, _ = workspaces.open(str(project))
    asset = assets.list_assets(workspace.project_id).items[0]
    translation = annotations.get_channel(
        workspace.project_id,
        asset.id,
        AnnotationChannel.TRANSLATION,
        "zh-CN",
    )

    assert translation.exists
    assert translation.language == "zh-CN"
    assert translation.content == "<caption>译文</caption>"
    assert [
        document.language
        for document in annotations.list(workspace.project_id, asset.id).documents
        if document.channel == AnnotationChannel.TRANSLATION
    ] == ["zh-CN"]


def test_legacy_translation_discovery_treats_image_stem_as_literal(tmp_path: Path) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "sample[1].png")
    (project / "sample[1].zh-cn.txt").write_text("<caption>正确译文</caption>", encoding="utf-8")
    (project / "sample1.zh-cn.txt").write_text("<caption>错误匹配</caption>", encoding="utf-8")

    workspace, _ = workspaces.open(str(project))
    asset = assets.list_assets(workspace.project_id).items[0]
    translation = annotations.get_channel(
        workspace.project_id,
        asset.id,
        AnnotationChannel.TRANSLATION,
        "zh-CN",
    )

    assert translation.exists
    assert translation.content == "<caption>正确译文</caption>"


def test_same_stem_assets_have_independent_database_channels(tmp_path: Path) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "same.jpg")
    _write_image(project / "same.png", (90, 130))
    sidecar = project / "same.txt"
    sidecar.write_text("<caption>legacy shared</caption>", encoding="utf-8")
    summary, _ = workspaces.open(str(project))
    indexed = assets.list_assets(summary.project_id).items

    first = annotations.save_text(
        summary.project_id,
        indexed[0].id,
        AnnotationChannel.DESCRIPTION,
        "<caption>first only</caption>",
    )
    second = annotations.get_channel(
        summary.project_id,
        indexed[1].id,
        AnnotationChannel.DESCRIPTION,
    )
    assert first.document.content == "<caption>first only</caption>"
    assert not second.exists

    annotations.delete(
        summary.project_id,
        indexed[0].id,
        AnnotationChannel.EXISTING,
    )
    assert sidecar.read_text(encoding="utf-8") == "<caption>legacy shared</caption>"
    assert annotations.get_channel(
        summary.project_id,
        indexed[1].id,
        AnnotationChannel.EXISTING,
    ).exists


def test_batch_delete_reports_channels_and_assets_without_primary_annotations(
    tmp_path: Path,
) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "annotated.png")
    _write_image(project / "missing.png")
    workspace, _ = workspaces.open(str(project))
    indexed = assets.list_assets(workspace.project_id).items
    by_name = {asset.filename: asset for asset in indexed}
    annotated_id = by_name["annotated.png"].id
    annotations.save_text(
        workspace.project_id,
        annotated_id,
        AnnotationChannel.DESCRIPTION,
        "<caption>description</caption>",
    )
    annotations.save_tags(
        workspace.project_id,
        annotated_id,
        [AnnotationTag(name="subject", origin="manual")],
    )

    result = annotations.delete_many(
        workspace.project_id,
        [annotated_id, by_name["missing.png"].id],
    )

    assert result.requested_count == 2
    assert result.deleted_count == 2
    assert result.missing_count == 1


def test_batch_annotation_options_review_and_delete_support_explicit_channels(
    tmp_path: Path,
) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    for name in ("first.png", "second.png", "missing.png"):
        _write_image(project / name)
    (project / "first.txt").write_text("<caption>legacy</caption>", encoding="utf-8")
    workspace, _ = workspaces.open(str(project))
    by_name = {asset.filename: asset for asset in assets.list_assets(workspace.project_id).items}
    selected_ids = [
        by_name["first.png"].id,
        by_name["second.png"].id,
        by_name["missing.png"].id,
    ]

    annotations.save_tags(
        workspace.project_id,
        by_name["first.png"].id,
        [AnnotationTag(name="first", origin="tagger")],
        review=True,
    )
    annotations.save_tags(
        workspace.project_id,
        by_name["second.png"].id,
        [AnnotationTag(name="second", origin="tagger")],
    )
    description = annotations.save_text(
        workspace.project_id,
        by_name["first.png"].id,
        AnnotationChannel.DESCRIPTION,
        "<caption>description</caption>",
    )
    annotations.save_text(
        workspace.project_id,
        by_name["first.png"].id,
        AnnotationChannel.TRANSLATION,
        "<caption>译文</caption>",
        language="zh-cn",
        input_revisions=((description.revision_id, "translation_source"),),
    )
    annotations.save_text(
        workspace.project_id,
        by_name["second.png"].id,
        AnnotationChannel.TRANSLATION,
        "<caption>翻訳</caption>",
        language="ja",
    )

    options = annotations.batch_options(workspace.project_id, selected_ids)
    by_target = {(option.channel, option.language or ""): option for option in options.targets}

    assert options.requested_count == 3
    assert set(by_target) == {
        (AnnotationChannel.EXISTING, ""),
        (AnnotationChannel.TAGS, ""),
        (AnnotationChannel.DESCRIPTION, ""),
        (AnnotationChannel.TRANSLATION, "ja"),
        (AnnotationChannel.TRANSLATION, "zh-CN"),
    }
    assert by_target[(AnnotationChannel.TAGS, "")].active_count == 2
    assert by_target[(AnnotationChannel.TAGS, "")].reviewable_count == 1
    assert by_target[(AnnotationChannel.TAGS, "")].reviewed_count == 1

    reviewed = annotations.review_targets_many(
        workspace.project_id,
        selected_ids,
        [
            AnnotationChannelTarget(channel=AnnotationChannel.TAGS),
            AnnotationChannelTarget(channel=AnnotationChannel.DESCRIPTION),
            AnnotationChannelTarget(
                channel=AnnotationChannel.TRANSLATION,
                language="zh-cn",
            ),
        ],
    )

    assert reviewed.target_count == 3
    assert reviewed.reviewed_count == 3
    assert reviewed.already_reviewed_count == 1
    assert reviewed.missing_count == 5

    delete_targets = [
        AnnotationChannelTarget(channel=AnnotationChannel.DESCRIPTION),
        AnnotationChannelTarget(
            channel=AnnotationChannel.TRANSLATION,
            language="zh-CN",
        ),
    ]
    paths, _ = workspaces.get(workspace.project_id)
    translation_claim = OutputResourceClaim(
        annotation_document_resource_key(
            by_name["first.png"].id,
            AnnotationChannel.TRANSLATION.value,
            "zh-CN",
        )
    )
    with (
        hold_output_resources(paths.database, [translation_claim]),
        pytest.raises(ResourceConflictError, match="写入"),
    ):
        annotations.delete_many(
            workspace.project_id,
            selected_ids,
            targets=delete_targets,
        )
    assert annotations.get_channel(
        workspace.project_id,
        by_name["first.png"].id,
        AnnotationChannel.DESCRIPTION,
    ).exists

    deleted = annotations.delete_many(
        workspace.project_id,
        selected_ids,
        targets=delete_targets,
    )

    assert deleted.target_count == 2
    assert deleted.deleted_count == 2
    assert deleted.missing_count == 2
    assert annotations.get_channel(
        workspace.project_id,
        by_name["first.png"].id,
        AnnotationChannel.TAGS,
    ).exists
    assert not annotations.get_channel(
        workspace.project_id,
        by_name["first.png"].id,
        AnnotationChannel.DESCRIPTION,
    ).exists
    assert not annotations.get_channel(
        workspace.project_id,
        by_name["first.png"].id,
        AnnotationChannel.TRANSLATION,
        "zh-CN",
    ).exists
    assert annotations.get_channel(
        workspace.project_id,
        by_name["second.png"].id,
        AnnotationChannel.TRANSLATION,
        "ja",
    ).exists


def test_review_queue_tracks_unreviewed_and_stale_database_channels(
    tmp_path: Path,
) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    image_path = project / "sample.png"
    _write_image(image_path)
    workspace, _ = workspaces.open(str(project))
    asset = assets.list_assets(workspace.project_id).items[0]
    tags = annotations.save_tags(
        workspace.project_id,
        asset.id,
        [AnnotationTag(name="subject", origin="tagger")],
    )
    assert tags.document.availability_status.value == "usable"
    assert tags.document.review_status.value == "unreviewed"
    assert (
        assets.list_assets(
            workspace.project_id,
            annotation_status="needs_review",
        ).total
        == 1
    )
    tags = annotations.save_tags(
        workspace.project_id,
        asset.id,
        [AnnotationTag(name="subject"), AnnotationTag(name="updated")],
        expected_head_revision_id=tags.revision_id,
    )

    unreviewed = assets.list_assets(
        workspace.project_id,
        annotation_status="needs_review",
    )
    assert [item.id for item in unreviewed.items] == [asset.id]
    assert unreviewed.status_counts["unreviewed"] == 1
    assert unreviewed.status_counts["stale"] == 0

    annotations.review(
        workspace.project_id,
        asset.id,
        AnnotationChannel.TAGS,
        tags.revision_id,
    )
    assert (
        assets.list_assets(
            workspace.project_id,
            annotation_status="needs_review",
        ).total
        == 0
    )

    _write_image(image_path, (130, 90))
    workspaces.rescan(workspace.project_id)
    stale = assets.list_assets(
        workspace.project_id,
        annotation_status="stale",
    )
    assert [item.id for item in stale.items] == [asset.id]
    assert stale.status_counts["needs_review"] == 1
    stale_document = annotations.get_channel(
        workspace.project_id,
        asset.id,
        AnnotationChannel.TAGS,
    )
    assert stale_document.availability_status.value == "stale"
    assert stale_document.review_status.value == "reviewed"

    batch_review = annotations.review_tags_many(
        workspace.project_id,
        [asset.id],
    )
    assert batch_review.reviewed_count == 1
    assert batch_review.already_reviewed_count == 0
    reviewed_for_current_image = annotations.get_channel(
        workspace.project_id,
        asset.id,
        AnnotationChannel.TAGS,
    )
    assert reviewed_for_current_image.review_status.value == "reviewed"
    assert reviewed_for_current_image.head_revision_id != tags.revision_id
    assert (
        assets.list_assets(
            workspace.project_id,
            annotation_status="needs_review",
        ).total
        == 0
    )
    assert (
        annotations.history(
            workspace.project_id,
            asset.id,
            AnnotationChannel.TAGS,
        )[0].source
        == "manual_review_current_image"
    )


def test_batch_review_tags_reports_reviewed_existing_and_missing_assets(
    tmp_path: Path,
) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    for name in ("reviewed.png", "pending.png", "missing.png"):
        _write_image(project / name)
    workspace, _ = workspaces.open(str(project))
    by_name = {asset.filename: asset for asset in assets.list_assets(workspace.project_id).items}
    already_reviewed = annotations.save_tags(
        workspace.project_id,
        by_name["reviewed.png"].id,
        [AnnotationTag(name="reviewed", origin="tagger")],
    )
    annotations.review(
        workspace.project_id,
        by_name["reviewed.png"].id,
        AnnotationChannel.TAGS,
        already_reviewed.revision_id,
    )
    annotations.save_tags(
        workspace.project_id,
        by_name["pending.png"].id,
        [AnnotationTag(name="pending", origin="manual")],
    )

    selected_ids = [
        by_name["reviewed.png"].id,
        by_name["pending.png"].id,
        by_name["missing.png"].id,
    ]
    result = annotations.review_tags_many(workspace.project_id, selected_ids)

    assert result.requested_count == 3
    assert result.reviewed_count == 1
    assert result.already_reviewed_count == 1
    assert result.missing_count == 1
    assert result.asset_ids == selected_ids
    assert (
        annotations.get_channel(
            workspace.project_id,
            by_name["pending.png"].id,
            AnnotationChannel.TAGS,
        ).review_status.value
        == "reviewed"
    )


def test_annotation_save_rejects_a_stale_database_revision(tmp_path: Path) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "sample.png")
    workspace, _ = workspaces.open(str(project))
    asset = assets.list_assets(workspace.project_id).items[0]

    first = annotations.save_text(
        workspace.project_id,
        asset.id,
        AnnotationChannel.DESCRIPTION,
        "<caption>first</caption>",
        expected_head_revision_id=None,
    )
    annotations.save_text(
        workspace.project_id,
        asset.id,
        AnnotationChannel.DESCRIPTION,
        "<caption>second</caption>",
        expected_head_revision_id=first.revision_id,
    )
    with pytest.raises(ResourceConflictError, match="版本已经变化"):
        annotations.save_text(
            workspace.project_id,
            asset.id,
            AnnotationChannel.DESCRIPTION,
            "<caption>stale editor</caption>",
            expected_head_revision_id=first.revision_id,
        )


def test_annotation_save_respects_an_active_document_lease(tmp_path: Path) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "sample.png")
    workspace, _ = workspaces.open(str(project))
    asset = assets.list_assets(workspace.project_id).items[0]
    paths, _ = workspaces.get(workspace.project_id)
    claim = OutputResourceClaim(
        annotation_document_resource_key(asset.id, AnnotationChannel.DESCRIPTION.value)
    )

    with (
        hold_output_resources(paths.database, [claim]),
        pytest.raises(ResourceConflictError, match="写入"),
    ):
        annotations.save_text(
            workspace.project_id,
            asset.id,
            AnnotationChannel.DESCRIPTION,
            "<caption>blocked</caption>",
        )

    saved = annotations.save_text(
        workspace.project_id,
        asset.id,
        AnnotationChannel.DESCRIPTION,
        "<caption>after lease</caption>",
    )
    assert saved.document.content == "<caption>after lease</caption>"


def test_asset_folder_tree_and_filter_use_subtree_boundaries(tmp_path: Path) -> None:
    workspaces, assets, _ = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "root.png")
    _write_image(project / "foo" / "direct.png")
    _write_image(project / "foo" / "nested" / "deep.png")
    _write_image(project / "foobar" / "other.png")
    summary, _ = workspaces.open(str(project))

    folders = {item.path: item for item in assets.list_folders(summary.project_id).items}
    assert folders[""].direct_asset_count == 1
    assert folders[""].descendant_asset_count == 4
    assert folders["foo"].direct_asset_count == 1
    assert folders["foo"].descendant_asset_count == 2
    assert folders["foo/nested"].parent_path == "foo"
    assert folders["foobar"].descendant_asset_count == 1

    in_foo = assets.list_assets(summary.project_id, folder_path="foo")
    assert [item.relative_path for item in in_foo.items] == [
        "foo/direct.png",
        "foo/nested/deep.png",
    ]
    assert in_foo.status_counts["all"] == 2
    assert in_foo.status_counts["missing"] == 2
    assert assets.list_asset_ids(summary.project_id, folder_path="foo").total == 2
    with pytest.raises(ValueError, match="当前工作区"):
        assets.list_assets(summary.project_id, folder_path="../outside")


def test_new_duplicate_does_not_steal_existing_asset_identity(tmp_path: Path) -> None:
    workspaces, assets, _ = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "z.png")
    summary, _ = workspaces.open(str(project))
    original = assets.list_assets(summary.project_id).items[0]
    (project / "a.png").write_bytes((project / "z.png").read_bytes())

    workspaces.rescan(summary.project_id)

    listed = assets.list_assets(summary.project_id).items
    assert [item.relative_path for item in listed] == ["a.png", "z.png"]
    assert len({item.id for item in listed}) == 2
    assert next(item for item in listed if item.relative_path == "z.png").id == original.id


def test_case_only_rename_preserves_asset_identity(tmp_path: Path) -> None:
    workspaces, assets, _ = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "Before.png")
    summary, _ = workspaces.open(str(project))
    original = assets.list_assets(summary.project_id).items[0]
    intermediate = project / "temporary-name.png"
    (project / "Before.png").rename(intermediate)
    intermediate.rename(project / "before.png")

    workspaces.rescan(summary.project_id)

    renamed = assets.list_assets(summary.project_id).items[0]
    assert renamed.relative_path == "before.png"
    assert renamed.id == original.id


def test_case_distinct_files_remain_distinct_when_filesystem_supports_them(
    tmp_path: Path,
) -> None:
    workspaces, assets, _ = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "Case.png")
    summary, _ = workspaces.open(str(project))
    _write_image(project / "case.png", (90, 130))
    if len(list(project.glob("*.png"))) < 2:
        pytest.skip("filesystem is case-insensitive")

    workspaces.rescan(summary.project_id)

    listed = assets.list_assets(summary.project_id).items
    assert {item.relative_path for item in listed} == {"Case.png", "case.png"}
    assert len({item.id for item in listed}) == 2


def test_thumbnail_cache_key_changes_with_image_content(tmp_path: Path) -> None:
    workspaces, assets, _ = _services(tmp_path)
    project = tmp_path / "dataset"
    image_path = project / "image.png"
    _write_image(image_path)
    summary, _ = workspaces.open(str(project))
    asset = assets.list_assets(summary.project_id).items[0]
    first_thumbnail = assets.thumbnail_path(summary.project_id, asset.id, 96)

    Image.new("RGB", (80, 120), "black").save(image_path)
    workspaces.rescan(summary.project_id)
    changed_asset = assets.list_assets(summary.project_id).items[0]
    second_thumbnail = assets.thumbnail_path(summary.project_id, asset.id, 96)

    assert changed_asset.content_version != asset.content_version
    assert first_thumbnail != second_thumbnail
    assert first_thumbnail.is_file()
    assert second_thumbnail.is_file()
