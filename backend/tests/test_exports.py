from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import cast

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from dataset_studio.api.app import create_app
from dataset_studio.api.container import AppContainer
from dataset_studio.core.config import Settings
from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.assets.service import AssetService
from dataset_studio.modules.exports.models import (
    ExportCreateRequest,
    ExportOperationStatus,
    ExportRequest,
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


def test_export_flattens_files_and_force_preserves_annotation_bytes(
    tmp_path: Path,
) -> None:
    workspaces, assets, _, exports = _services(tmp_path)
    project = tmp_path / "数据集"
    _write_image(project / "a" / "valid.png", "red")
    _write_image(project / "b" / "missing.webp", "green")
    _write_image(project / "c" / "empty.jpg", "blue")
    _write_image(project / "d" / "invalid.png", "yellow")
    _write_image(project / "e" / "encoded.png", "purple")
    (project / "a" / "valid.txt").write_text("<caption>ok</caption>", encoding="utf-8")
    (project / "c" / "empty.txt").write_bytes(b" \n")
    (project / "d" / "invalid.txt").write_text("<caption>broken", encoding="utf-8")
    encoded_bytes = b"\xff\xfelegacy"
    (project / "e" / "encoded.txt").write_bytes(encoded_bytes)
    workspace, _ = workspaces.open(str(project))
    destination = tmp_path / "导出 目录"
    destination.mkdir()
    request = ExportRequest(destination_path=str(destination))

    preview = exports.preview(workspace.project_id, request)

    assert preview.total_items == 5
    assert preview.valid_count == 1
    assert preview.missing_count == 1
    assert preview.empty_count == 1
    assert preview.invalid_count == 1
    assert preview.encoding_error_count == 1
    assert preview.warning_count == 4
    assert preview.blocking_issue_count == 0
    encoded_asset = next(
        item
        for item in assets.list_assets(workspace.project_id).items
        if item.filename == "encoded.png"
    )
    assert encoded_asset.annotation_status.value == "encoding_error"
    with pytest.raises(ValueError, match="明确允许强制导出"):
        exports.create(
            workspace.project_id,
            ExportCreateRequest(
                request=request,
                preview_token=preview.preview_token,
            ),
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

    completed = exports.get(workspace.project_id, operation.id)
    assert completed.status == ExportOperationStatus.COMPLETED
    assert completed.completed_items == 5
    assert {path.name for path in destination.iterdir()} == {
        "valid.png",
        "valid.txt",
        "missing.webp",
        "empty.jpg",
        "empty.txt",
        "invalid.png",
        "invalid.txt",
        "encoded.png",
        "encoded.txt",
    }
    assert all(path.is_file() for path in destination.iterdir())
    assert (destination / "valid.png").read_bytes() == (project / "a" / "valid.png").read_bytes()
    assert (destination / "empty.txt").read_bytes() == b" \n"
    assert (destination / "invalid.txt").read_text(encoding="utf-8") == "<caption>broken"
    assert (destination / "encoded.txt").read_bytes() == encoded_bytes
    assert not (destination / "missing.txt").exists()


def test_manually_accepted_annotation_is_exportable_without_warning(tmp_path: Path) -> None:
    workspaces, assets, annotations, exports = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "accepted.png")
    workspace, _ = workspaces.open(str(project))
    asset = assets.list_assets(workspace.project_id).items[0]
    annotations.save_generated(
        workspace.project_id,
        asset.id,
        "<caption>accepted despite missing close tag",
        manually_accepted=True,
    )
    destination = tmp_path / "accepted-export"
    destination.mkdir()

    preview = exports.preview(
        workspace.project_id,
        ExportRequest(destination_path=str(destination)),
    )

    assert preview.total_items == 1
    assert preview.manually_accepted_count == 1
    assert preview.warning_count == 0
    assert preview.items[0].annotation_status == "manually_accepted"
    operation = exports.create(
        workspace.project_id,
        ExportCreateRequest(
            request=ExportRequest(destination_path=str(destination)),
            preview_token=preview.preview_token,
        ),
    )
    _run_export(workspaces, workspace.project_id, operation.id)
    assert exports.get(workspace.project_id, operation.id).status == (
        ExportOperationStatus.COMPLETED
    )
    assert {entry.name for entry in destination.iterdir()} == {
        "accepted.png",
        "accepted.txt",
    }


def test_export_preview_blocks_nonempty_destination_and_flat_name_collisions(
    tmp_path: Path,
) -> None:
    workspaces, _, _, exports = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "one" / "same.png")
    _write_image(project / "two" / "same.jpg")
    (project / "one" / "same.txt").write_text("first", encoding="utf-8")
    (project / "two" / "same.txt").write_text("second", encoding="utf-8")
    workspace, _ = workspaces.open(str(project))
    destination = tmp_path / "flat-export"
    destination.mkdir()

    collision_preview = exports.preview(
        workspace.project_id,
        ExportRequest(destination_path=str(destination)),
    )

    assert collision_preview.blocking_issue_count == 2
    assert all(
        item.blocking_issue and "同名文件冲突" in item.blocking_issue
        for item in collision_preview.items
    )
    with pytest.raises(ValueError, match="同名文件冲突"):
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


def test_export_selected_scope_and_stale_preview(tmp_path: Path) -> None:
    workspaces, assets, _, exports = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "first.png")
    _write_image(project / "second.png")
    (project / "first.txt").write_text("first", encoding="utf-8")
    (project / "second.txt").write_text("second", encoding="utf-8")
    workspace, _ = workspaces.open(str(project))
    listed = assets.list_assets(workspace.project_id).items
    selected = next(item for item in listed if item.filename == "second.png")
    destination = tmp_path / "selected-export"
    destination.mkdir()
    request = ExportRequest(
        scope="selected",
        asset_ids=[selected.id],
        destination_path=str(destination),
    )
    preview = exports.preview(workspace.project_id, request)
    assert preview.total_items == 1
    assert preview.items[0].source_relative_path == "second.png"

    (project / "second.txt").write_text("changed", encoding="utf-8")
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
            json={"content": "changed"},
        )
        assert blocked_edit.status_code == 400
        assert "正在导出" in blocked_edit.json()["detail"]

        stopped = client.post(
            f"/api/v1/workspaces/{project_id}/exports/{created.json()['id']}/stop"
        )
        assert stopped.status_code == 200
        assert stopped.json()["status"] == "stopped"
