from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import cast

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from dataset_studio.api.app import create_app
from dataset_studio.api.container import AppContainer
from dataset_studio.core.config import Settings
from dataset_studio.modules.annotations.models import AnnotationChannel, AnnotationTag
from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.assets.service import AssetService
from dataset_studio.modules.exports.models import (
    ExportChannelSelection,
    ExportCreateRequest,
    ExportFormat,
    ExportOperationStatus,
    ExportRequest,
    ExportRevisionMode,
)
from dataset_studio.modules.exports.repository import ExportRepository
from dataset_studio.modules.exports.service import ExportService
from dataset_studio.modules.exports.worker import ExportWorker
from dataset_studio.modules.workspaces.repository import WorkspaceRegistry
from dataset_studio.modules.workspaces.service import WorkspaceService
from dataset_studio.platform.global_store import initialize_global_database


def _services(tmp_path: Path):
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    settings.ensure_directories()
    global_database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(global_database)
    workspaces = WorkspaceService(settings, WorkspaceRegistry(global_database))
    return (
        workspaces,
        AssetService(workspaces),
        AnnotationService(workspaces),
        ExportService(workspaces),
    )


def _write_image(path: Path, color: str = "white") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (48, 32), color).save(path)


def _run_export(workspaces: WorkspaceService, project_id: str, operation_id: str) -> None:
    paths, _ = workspaces.get(project_id)
    repository = ExportRepository(paths.database)
    claimed = repository.claim_next_operation()
    assert claimed is not None
    assert claimed.id == operation_id
    container = cast(AppContainer, SimpleNamespace(workspaces=workspaces))
    ExportWorker(container)._process_operation(project_id, operation_id)


def test_idle_export_worker_does_not_scan_recent_workspaces(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspaces, _, _, _ = _services(tmp_path)
    project = tmp_path / "idle-dataset"
    project.mkdir()
    workspaces.open(str(project))

    def fail_recent_scan():
        raise AssertionError("idle export worker must not enumerate recent workspaces")

    monkeypatch.setattr(workspaces, "list_recent", fail_recent_scan)
    container = cast(AppContainer, SimpleNamespace(workspaces=workspaces))

    assert ExportWorker(container)._claim_next() is None


def test_export_materializes_multiple_database_channels_as_variants_and_json(
    tmp_path: Path,
) -> None:
    workspaces, assets, annotations, exports = _services(tmp_path)
    project = tmp_path / "数据集"
    _write_image(project / "a" / "first.png", "red")
    _write_image(project / "b" / "second.webp", "green")
    workspace, _ = workspaces.open(str(project))
    by_name = {asset.filename: asset for asset in assets.list_assets(workspace.project_id).items}
    for asset in by_name.values():
        annotations.save_tags(
            workspace.project_id,
            asset.id,
            [
                AnnotationTag(name="character", category="general", origin="manual"),
                AnnotationTag(name=asset.filename.split(".")[0], origin="manual"),
            ],
            confirm=True,
        )
        annotations.save_text(
            workspace.project_id,
            asset.id,
            AnnotationChannel.DESCRIPTION,
            f"<caption>{asset.filename}</caption>",
            confirm=True,
        )

    destination = tmp_path / "export"
    destination.mkdir()
    request = ExportRequest(
        destination_path=str(destination),
        channels=[
            ExportChannelSelection(channel=AnnotationChannel.TAGS),
            ExportChannelSelection(channel=AnnotationChannel.DESCRIPTION),
        ],
        formats=[ExportFormat.TXT, ExportFormat.JSON],
    )
    preview = exports.preview(workspace.project_id, request)

    assert preview.total_items == 2
    assert preview.valid_count == 2
    assert preview.warning_count == 0
    assert set(preview.items[0].channel_statuses.values()) == {"confirmed"}
    assert any(target.startswith("tags/") for target in preview.items[0].target_outputs)
    assert any(target.startswith("description/") for target in preview.items[0].target_outputs)
    assert any(target.startswith("metadata/") for target in preview.items[0].target_outputs)

    operation = exports.create(
        workspace.project_id,
        ExportCreateRequest(request=request, preview_token=preview.preview_token),
    )
    _run_export(workspaces, workspace.project_id, operation.id)

    completed = exports.get(workspace.project_id, operation.id)
    assert completed.status == ExportOperationStatus.COMPLETED
    assert completed.configuration_snapshot["formats"] == ["txt", "json"]
    assert (destination / "tags" / "first.png").read_bytes() == (
        project / "a" / "first.png"
    ).read_bytes()
    assert (destination / "tags" / "first.txt").read_text(encoding="utf-8") == ("character, first")
    assert (destination / "description" / "first.txt").read_text(encoding="utf-8") == (
        "<caption>first.png</caption>"
    )
    metadata = json.loads(
        (destination / "metadata" / "first.annotations.json").read_text(encoding="utf-8")
    )
    assert [tag["name"] for tag in metadata["annotations"]["tags"]["tags"]] == [
        "character",
        "first",
    ]
    assert metadata["annotations"]["description"]["content"] == "<caption>first.png</caption>"


def test_force_export_preserves_invalid_legacy_bytes_from_frozen_revision(
    tmp_path: Path,
) -> None:
    workspaces, _, _, exports = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "image.png")
    encoded_bytes = b"\xff\xfelegacy"
    (project / "image.txt").write_bytes(encoded_bytes)
    workspace, _ = workspaces.open(str(project))
    destination = tmp_path / "raw-export"
    destination.mkdir()
    request = ExportRequest(destination_path=str(destination))
    preview = exports.preview(workspace.project_id, request)

    assert preview.total_items == 1
    assert preview.encoding_error_count == 1
    assert preview.warning_count == 1
    with pytest.raises(ValueError, match="标注警告"):
        exports.create(
            workspace.project_id,
            ExportCreateRequest(request=request, preview_token=preview.preview_token),
        )

    operation = exports.create(
        workspace.project_id,
        ExportCreateRequest(
            request=request,
            preview_token=preview.preview_token,
            allow_warnings=True,
        ),
    )
    _run_export(workspaces, workspace.project_id, operation.id)
    assert (destination / "image.txt").read_bytes() == encoded_bytes
    assert (project / "image.txt").read_bytes() == encoded_bytes


def test_export_preview_blocks_nonempty_destination_and_flat_name_collisions(
    tmp_path: Path,
) -> None:
    workspaces, _, _, exports = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "same.jpg")
    _write_image(project / "same.png", "black")
    (project / "same.txt").write_text("<caption>shared</caption>", encoding="utf-8")
    workspace, _ = workspaces.open(str(project))
    destination = tmp_path / "collision-export"
    destination.mkdir()

    collision_preview = exports.preview(
        workspace.project_id,
        ExportRequest(destination_path=str(destination)),
    )
    assert collision_preview.blocking_issue_count == 2
    assert all(
        item.blocking_issue and "同一个目标文件" in item.blocking_issue
        for item in collision_preview.items
    )
    with pytest.raises(ValueError, match="同一个目标文件"):
        exports.create(
            workspace.project_id,
            ExportCreateRequest(
                request=ExportRequest(destination_path=str(destination)),
                preview_token=collision_preview.preview_token,
                allow_warnings=True,
            ),
        )

    (destination / "keep.me").write_text("occupied", encoding="utf-8")
    occupied_preview = exports.preview(
        workspace.project_id,
        ExportRequest(destination_path=str(destination)),
    )
    assert "导出目录必须为空" in occupied_preview.blocking_issues[0]

    inside_workspace = project / "export"
    inside_workspace.mkdir()
    inside_preview = exports.preview(
        workspace.project_id,
        ExportRequest(destination_path=str(inside_workspace)),
    )
    assert "导出目录不能位于当前项目内部" in inside_preview.blocking_issues[0]


def test_export_preview_is_invalidated_by_a_new_revision_even_with_same_content(
    tmp_path: Path,
) -> None:
    workspaces, assets, annotations, exports = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "first.png")
    _write_image(project / "second.png")
    workspace, _ = workspaces.open(str(project))
    listed = assets.list_assets(workspace.project_id).items
    selected = next(item for item in listed if item.filename == "second.png")
    first = annotations.save_text(
        workspace.project_id,
        selected.id,
        AnnotationChannel.DESCRIPTION,
        "same content",
        confirm=True,
    )
    destination = tmp_path / "selected-export"
    destination.mkdir()
    request = ExportRequest(
        scope="selected",
        asset_ids=[selected.id],
        destination_path=str(destination),
        channels=[
            ExportChannelSelection(
                channel=AnnotationChannel.DESCRIPTION,
                revision=ExportRevisionMode.CONFIRMED,
            )
        ],
    )
    preview = exports.preview(workspace.project_id, request)
    assert preview.total_items == 1

    annotations.save_text(
        workspace.project_id,
        selected.id,
        AnnotationChannel.DESCRIPTION,
        "same content",
        expected_head_revision_id=first.revision_id,
        confirm=True,
    )
    with pytest.raises(ValueError, match="预览已失效"):
        exports.create(
            workspace.project_id,
            ExportCreateRequest(
                request=request,
                preview_token=preview.preview_token,
            ),
        )


def test_stopped_export_can_resume_from_project_database(tmp_path: Path) -> None:
    workspaces, _, _, exports = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "image.png")
    (project / "image.txt").write_text("ready", encoding="utf-8")
    workspace, _ = workspaces.open(str(project))
    destination = tmp_path / "resume-export"
    destination.mkdir()
    request = ExportRequest(destination_path=str(destination))
    preview = exports.preview(workspace.project_id, request)
    operation = exports.create(
        workspace.project_id,
        ExportCreateRequest(request=request, preview_token=preview.preview_token),
    )
    paths, _ = workspaces.get(workspace.project_id)
    repository = ExportRepository(paths.database)
    assert repository.claim_next_operation() is not None
    assert repository.request_stop(operation.id)

    container = cast(AppContainer, SimpleNamespace(workspaces=workspaces))
    worker = ExportWorker(container)
    worker._process_operation(workspace.project_id, operation.id)
    assert exports.get(workspace.project_id, operation.id).status == ExportOperationStatus.STOPPED
    assert list(destination.iterdir()) == []

    resumed = exports.resume(workspace.project_id, operation.id)
    assert resumed.status == ExportOperationStatus.QUEUED
    _run_export(workspaces, workspace.project_id, operation.id)
    assert exports.get(workspace.project_id, operation.id).status == ExportOperationStatus.COMPLETED
    assert {entry.name for entry in destination.iterdir()} == {"image.png", "image.txt"}


def test_export_api_uses_persistent_active_state_and_blocks_annotation_edits(
    tmp_path: Path,
) -> None:
    project = tmp_path / "dataset"
    _write_image(project / "image.png")
    (project / "image.txt").write_text("ready", encoding="utf-8")
    destination = tmp_path / "api-export"
    destination.mkdir()
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)

    with TestClient(create_app(settings)) as client:
        opened = client.post("/api/v1/workspaces/open", json={"path": str(project)})
        project_id = opened.json()["workspace"]["project_id"]
        asset_id = client.get(f"/api/v1/workspaces/{project_id}/assets").json()["items"][0]["id"]
        request = {
            "scope": "all",
            "asset_ids": [],
            "destination_path": str(destination),
            "channels": [
                {
                    "channel": "existing_annotation",
                    "language": "",
                    "revision": "confirmed",
                }
            ],
            "formats": ["txt"],
        }
        preview = client.post(
            f"/api/v1/workspaces/{project_id}/exports/preview",
            json=request,
        )
        assert preview.status_code == 200
        created = client.post(
            f"/api/v1/workspaces/{project_id}/exports",
            json={
                "request": request,
                "preview_token": preview.json()["preview_token"],
                "allow_warnings": False,
            },
        )
        assert created.status_code == 201
        assert created.json()["status"] == "queued"
        active = client.get("/api/v1/jobs/active")
        assert active.json()["export_count"] == 1

        blocked_edit = client.put(
            f"/api/v1/workspaces/{project_id}/assets/{asset_id}/annotation",
            json={"content": "changed", "expected_modified_at": None},
        )
        assert blocked_edit.status_code == 400
        assert "正在导出" in blocked_edit.json()["detail"]

        stopped = client.post(
            f"/api/v1/workspaces/{project_id}/exports/{created.json()['id']}/stop"
        )
        assert stopped.status_code == 200
        assert stopped.json()["status"] == "stopped"
