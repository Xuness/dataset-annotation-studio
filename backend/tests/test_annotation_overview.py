from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from dataset_studio.api.app import create_app
from dataset_studio.core.config import Settings
from dataset_studio.modules.annotations.models import AnnotationChannel, AnnotationTag
from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.assets.service import AssetService
from dataset_studio.modules.translations.service import TranslationService
from dataset_studio.modules.workspaces.repository import WorkspaceRegistry
from dataset_studio.modules.workspaces.service import WorkspaceService
from dataset_studio.platform.global_store import initialize_global_database


def test_annotation_overview_aggregates_current_channel_and_translation_states(
    tmp_path: Path,
) -> None:
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    settings.ensure_directories()
    global_database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(global_database)
    workspaces = WorkspaceService(settings, WorkspaceRegistry(global_database))
    project = tmp_path / "dataset"
    project.mkdir()
    for name in ("one", "two", "three"):
        Image.new("RGB", (32, 32), "white").save(project / f"{name}.png")

    workspace, _ = workspaces.open(str(project))
    assets = AssetService(workspaces).list_assets(workspace.project_id).items
    by_name = {asset.filename: asset for asset in assets}
    annotations = AnnotationService(workspaces)
    translations = TranslationService(workspaces, annotations)

    annotations.save_tags(
        workspace.project_id,
        by_name["one.png"].id,
        [AnnotationTag(name="subject")],
    )
    annotations.save_tags(workspace.project_id, by_name["two.png"].id, [])
    annotations.save_tags(
        workspace.project_id,
        by_name["three.png"].id,
        [AnnotationTag(name="temporary")],
    )
    annotations.delete(
        workspace.project_id,
        by_name["three.png"].id,
        AnnotationChannel.TAGS,
    )

    first_description = annotations.save_text(
        workspace.project_id,
        by_name["one.png"].id,
        AnnotationChannel.DESCRIPTION,
        "<caption>source</caption>",
    )
    translations.save_manual(
        workspace.project_id,
        by_name["one.png"].id,
        "zh-CN",
        "<caption>译文</caption>",
        expected_head_revision_id=None,
    )
    annotations.save_text(
        workspace.project_id,
        by_name["one.png"].id,
        AnnotationChannel.DESCRIPTION,
        "<caption>updated source</caption>",
        expected_head_revision_id=first_description.revision_id,
    )
    translations.save_manual(
        workspace.project_id,
        by_name["one.png"].id,
        "en",
        "<caption>translated source</caption>",
        expected_head_revision_id=None,
    )

    with TestClient(create_app(settings)) as client:
        response = client.get(f"/api/v1/workspaces/{workspace.project_id}/annotations/overview")

    assert response.status_code == 200
    overview = response.json()
    assert overview["asset_count"] == 3
    assert [item["channel"] for item in overview["channels"]] == [
        "existing_annotation",
        "tags",
        "description",
        "translation",
    ]
    channels = {item["channel"]: item for item in overview["channels"]}
    assert channels["existing_annotation"] == {
        "channel": "existing_annotation",
        "active_document_count": 0,
        "present_asset_count": 0,
        "usable_asset_count": 0,
        "stale_asset_count": 0,
        "invalid_asset_count": 0,
        "missing_asset_count": 3,
    }
    assert channels["tags"] == {
        "channel": "tags",
        "active_document_count": 2,
        "present_asset_count": 2,
        "usable_asset_count": 1,
        "stale_asset_count": 0,
        "invalid_asset_count": 1,
        "missing_asset_count": 1,
    }
    assert channels["description"] == {
        "channel": "description",
        "active_document_count": 1,
        "present_asset_count": 1,
        "usable_asset_count": 1,
        "stale_asset_count": 0,
        "invalid_asset_count": 0,
        "missing_asset_count": 2,
    }
    assert channels["translation"] == {
        "channel": "translation",
        "active_document_count": 2,
        "present_asset_count": 1,
        "usable_asset_count": 1,
        "stale_asset_count": 0,
        "invalid_asset_count": 0,
        "missing_asset_count": 2,
    }
    assert [
        (
            item["language"],
            item["translation_source_kind"],
            item["translation_producer_kind"],
            item["usable_asset_count"],
            item["stale_asset_count"],
        )
        for item in overview["translation_variants"]
    ] == [
        ("en", "description", "llm", 1, 0),
        ("zh-CN", "description", "llm", 0, 1),
    ]
    assert not any(project.glob("*.txt"))
