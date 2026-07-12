from pathlib import Path

from PIL import Image

from dataset_studio.core.config import Settings
from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.assets.service import AssetService
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

    moved = tmp_path / "Style" / "MovedExample"
    moved.parent.mkdir()
    project.rename(moved)
    reopened, _ = workspaces.open(str(moved))

    assert reopened.project_id == summary.project_id
    assert reopened.root_path == str(moved.resolve())


def test_annotation_save_delete_and_history(tmp_path: Path) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "image.jpg")
    summary, _ = workspaces.open(str(project))
    asset = assets.list_assets(summary.project_id).items[0]

    saved = annotations.save(summary.project_id, asset.id, "<root>text</root>")
    assert saved.exists is True
    assert (project / "image.txt").read_text(encoding="utf-8") == "<root>text</root>"

    deleted = annotations.delete(summary.project_id, asset.id)
    assert deleted.exists is False
    assert not (project / "image.txt").exists()
    history = annotations.history(summary.project_id, asset.id)
    assert [revision["source"] for revision in history] == [
        "deleted_snapshot",
        "manual_edit",
    ]
