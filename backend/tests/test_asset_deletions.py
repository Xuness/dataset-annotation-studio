import os
from pathlib import Path, PurePosixPath

import pytest
from PIL import Image

from dataset_studio.core.config import Settings
from dataset_studio.modules.assets.deletions.models import (
    AssetDeleteStatus,
    AssetDeletionExecuteRequest,
    AssetDeletionRequest,
)
from dataset_studio.modules.assets.deletions.repository import AssetDeletionRepository
from dataset_studio.modules.assets.deletions.service import AssetDeletionService
from dataset_studio.modules.assets.service import AssetService
from dataset_studio.modules.workspaces.repository import WorkspaceRegistry
from dataset_studio.modules.workspaces.service import WorkspaceService
from dataset_studio.platform.global_store import initialize_global_database


def _services(tmp_path: Path):
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    settings.ensure_directories()
    global_database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(global_database)
    workspaces = WorkspaceService(settings, WorkspaceRegistry(global_database))
    return workspaces, AssetService(workspaces), AssetDeletionService(workspaces)


def _write_image(path: Path, size: tuple[int, int] = (80, 120)) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, color=(225, 211, 198)).save(path)


def _execute(
    deletions: AssetDeletionService,
    project_id: str,
    asset_ids: list[str],
):
    request = AssetDeletionRequest(asset_ids=asset_ids)
    preview = deletions.preview(project_id, request)
    return deletions.execute(
        project_id,
        AssetDeletionExecuteRequest(
            request=request,
            preview_token=preview.preview_token,
        ),
    )


def test_asset_bundle_deletion_is_recoverable(tmp_path: Path) -> None:
    workspaces, assets, deletions = _services(tmp_path)
    project = tmp_path / "dataset"
    image = project / "nested" / "image.png"
    annotation = project / "nested" / "image.txt"
    translation = project / "nested" / "image.zh-CN.txt"
    metadata = project / "nested" / "image.json"
    _write_image(image)
    annotation.write_text("<caption>source</caption>", encoding="utf-8")
    translation.write_text("<caption>译文</caption>", encoding="utf-8")
    metadata.write_text('{"artist":"test"}', encoding="utf-8")
    original_bytes = {
        path: path.read_bytes() for path in (image, annotation, translation, metadata)
    }

    workspace, _ = workspaces.open(str(project))
    asset = assets.list_assets(workspace.project_id).items[0]
    request = AssetDeletionRequest(asset_ids=[asset.id])
    preview = deletions.preview(workspace.project_id, request)

    assert preview.blocking_issues == []
    assert (
        preview.image_count,
        preview.annotation_count,
        preview.translation_count,
        preview.metadata_count,
    ) == (1, 1, 1, 1)

    operation = deletions.execute(
        workspace.project_id,
        AssetDeletionExecuteRequest(
            request=request,
            preview_token=preview.preview_token,
        ),
    )

    assert operation.status == AssetDeleteStatus.COMPLETED
    assert assets.list_assets(workspace.project_id).items == []
    assert all(not path.exists() for path in original_bytes)
    paths, _ = workspaces.get(workspace.project_id)
    recovery_root = paths.recovery / "deletions" / operation.id
    assert recovery_root.is_dir()

    restored = deletions.undo(workspace.project_id, operation.id)

    assert restored.status == AssetDeleteStatus.UNDONE
    assert [item.id for item in assets.list_assets(workspace.project_id).items] == [asset.id]
    assert {path: path.read_bytes() for path in original_bytes} == original_bytes
    assert not recovery_root.exists()


def test_deletion_preserves_sidecars_shared_with_unselected_image(tmp_path: Path) -> None:
    workspaces, assets, deletions = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "same.jpg")
    _write_image(project / "same.png", (90, 130))
    (project / "same.txt").write_text("<caption>shared</caption>", encoding="utf-8")
    (project / "same.zh-CN.txt").write_text("<caption>共享</caption>", encoding="utf-8")
    (project / "same.json").write_text('{"shared":true}', encoding="utf-8")
    workspace, _ = workspaces.open(str(project))
    indexed = assets.list_assets(workspace.project_id).items
    selected = next(item for item in indexed if item.filename == "same.jpg")

    request = AssetDeletionRequest(asset_ids=[selected.id])
    preview = deletions.preview(workspace.project_id, request)

    assert preview.image_count == 1
    assert preview.annotation_count == 0
    assert preview.translation_count == 0
    assert preview.metadata_count == 0
    assert preview.shared_sidecar_count == 3
    assert preview.warnings

    _execute(deletions, workspace.project_id, [selected.id])

    assert not (project / "same.jpg").exists()
    assert (project / "same.png").is_file()
    assert (project / "same.txt").is_file()
    assert (project / "same.zh-CN.txt").is_file()
    assert (project / "same.json").is_file()


def test_stale_deletion_preview_does_not_move_any_file(tmp_path: Path) -> None:
    workspaces, assets, deletions = _services(tmp_path)
    project = tmp_path / "dataset"
    image = project / "image.png"
    _write_image(image)
    workspace, _ = workspaces.open(str(project))
    asset = assets.list_assets(workspace.project_id).items[0]
    request = AssetDeletionRequest(asset_ids=[asset.id])
    preview = deletions.preview(workspace.project_id, request)
    Image.new("RGB", (81, 120), "black").save(image)

    with pytest.raises(ValueError, match="预览已失效"):
        deletions.execute(
            workspace.project_id,
            AssetDeletionExecuteRequest(
                request=request,
                preview_token=preview.preview_token,
            ),
        )

    assert image.is_file()
    assert deletions.list_operations(workspace.project_id) == []


def test_execution_failure_restores_moved_files(tmp_path: Path, monkeypatch) -> None:
    workspaces, assets, deletions = _services(tmp_path)
    project = tmp_path / "dataset"
    image = project / "image.png"
    annotation = project / "image.txt"
    _write_image(image)
    annotation.write_text("<caption>keep</caption>", encoding="utf-8")
    workspace, _ = workspaces.open(str(project))
    asset = assets.list_assets(workspace.project_id).items[0]

    def fail_complete(_repository, _operation_id):
        raise RuntimeError("simulated database failure")

    monkeypatch.setattr(AssetDeletionRepository, "complete", fail_complete)
    with pytest.raises(RuntimeError, match="simulated database failure"):
        _execute(deletions, workspace.project_id, [asset.id])

    assert image.is_file()
    assert annotation.read_text(encoding="utf-8") == "<caption>keep</caption>"
    operation = deletions.list_operations(workspace.project_id)[0]
    assert operation.status == AssetDeleteStatus.FAILED
    assert assets.list_assets(workspace.project_id).total == 1


def test_interrupted_undo_is_finished_on_recovery(tmp_path: Path) -> None:
    workspaces, assets, deletions = _services(tmp_path)
    project = tmp_path / "dataset"
    image = project / "image.png"
    annotation = project / "image.txt"
    _write_image(image)
    annotation.write_text("<caption>recover</caption>", encoding="utf-8")
    workspace, _ = workspaces.open(str(project))
    asset = assets.list_assets(workspace.project_id).items[0]
    operation = _execute(deletions, workspace.project_id, [asset.id])
    paths, _ = workspaces.get(workspace.project_id)
    repository = AssetDeletionRepository(paths.database)
    repository.begin_undo(operation.id)
    first = repository.files(operation.id)[0]
    source = paths.root / Path(PurePosixPath(first.source_relative_path))
    recovery = paths.root / Path(PurePosixPath(first.recovery_relative_path))
    source.parent.mkdir(parents=True, exist_ok=True)
    os.replace(recovery, source)
    repository.set_file_phase(first.id, "restored")

    assert deletions.recover_orphaned(workspace.project_id) == 1

    recovered = repository.get(operation.id)
    assert recovered is not None
    assert recovered.status == AssetDeleteStatus.UNDONE
    assert image.is_file()
    assert annotation.is_file()
    assert assets.list_assets(workspace.project_id).total == 1
