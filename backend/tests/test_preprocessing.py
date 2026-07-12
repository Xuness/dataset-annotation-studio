from pathlib import Path

import pytest
from PIL import Image

from dataset_studio.core.config import Settings
from dataset_studio.modules.assets.service import AssetService
from dataset_studio.modules.preprocessing.models import (
    ConvertOptions,
    OutputFormat,
    PreprocessRequest,
    ResizeOptions,
)
from dataset_studio.modules.preprocessing.service import PreprocessService
from dataset_studio.modules.workspaces.repository import WorkspaceRegistry
from dataset_studio.modules.workspaces.service import WorkspaceService
from dataset_studio.platform.global_store import initialize_global_database


def _services(tmp_path: Path):
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    settings.ensure_directories()
    global_database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(global_database)
    workspaces = WorkspaceService(settings, WorkspaceRegistry(global_database))
    return workspaces, AssetService(workspaces), PreprocessService(workspaces)


def test_resize_convert_and_undo_preserves_asset_identity(tmp_path: Path) -> None:
    workspaces, assets, preprocessing = _services(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    Image.new("RGB", (400, 200), (220, 200, 180)).save(project / "sample.png")
    (project / "sample.txt").write_text("<caption>kept</caption>", encoding="utf-8")
    summary, _ = workspaces.open(str(project))
    before = assets.list_assets(summary.project_id).items[0]
    request = PreprocessRequest(
        resize=ResizeOptions(max_edge=100, allow_upscale=False),
        convert=ConvertOptions(format=OutputFormat.WEBP, quality=88, effort=4),
    )

    preview = preprocessing.preview(summary.project_id, request)
    assert preview.changed_count == 1
    assert preview.items[0].after_width == 100
    assert preview.items[0].after_height == 50

    operation = preprocessing.execute(summary.project_id, request)
    assert operation.status == "completed"
    assert not (project / "sample.png").exists()
    assert (project / "sample.webp").is_file()
    assert (project / "sample.txt").is_file()
    with Image.open(project / "sample.webp") as image:
        assert image.size == (100, 50)
    after = assets.list_assets(summary.project_id).items[0]
    assert after.id == before.id
    assert after.relative_path == "sample.webp"
    recovery = project / ".annotation-workspace" / "recovery" / operation.id
    assert (recovery / "files" / "sample.png").is_file()

    undone = preprocessing.undo(summary.project_id, operation.id)
    assert undone.status == "undone"
    assert (project / "sample.png").is_file()
    assert not (project / "sample.webp").exists()
    restored = assets.list_assets(summary.project_id).items[0]
    assert restored.id == before.id
    assert restored.relative_path == "sample.png"
    with Image.open(project / "sample.png") as image:
        assert image.size == (400, 200)


def test_failed_asset_update_restores_original_file(tmp_path: Path, monkeypatch) -> None:
    workspaces, _, preprocessing = _services(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    Image.new("RGB", (320, 160), "white").save(project / "sample.png")
    summary, _ = workspaces.open(str(project))
    request = PreprocessRequest(
        resize=ResizeOptions(max_edge=100),
        convert=ConvertOptions(format=OutputFormat.WEBP),
    )

    def fail_asset_update(*_args, **_kwargs):
        raise RuntimeError("simulated database failure")

    monkeypatch.setattr(preprocessing, "_update_asset", fail_asset_update)
    with pytest.raises(RuntimeError, match="simulated database failure"):
        preprocessing.execute(summary.project_id, request)

    assert (project / "sample.png").is_file()
    assert not (project / "sample.webp").exists()
    with Image.open(project / "sample.png") as image:
        assert image.size == (320, 160)
