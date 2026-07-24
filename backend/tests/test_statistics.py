from pathlib import Path

from PIL import Image

from dataset_studio.core.config import Settings
from dataset_studio.modules.annotations.models import AnnotationTag
from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.assets.service import AssetService
from dataset_studio.modules.statistics.service import StatisticsService
from dataset_studio.modules.workspaces.repository import WorkspaceRegistry
from dataset_studio.modules.workspaces.service import WorkspaceService
from dataset_studio.platform.global_store import initialize_global_database


def test_tag_frequency_is_a_read_only_replaceable_projection(tmp_path: Path) -> None:
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    settings.ensure_directories()
    global_database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(global_database)
    workspaces = WorkspaceService(settings, WorkspaceRegistry(global_database))
    project = tmp_path / "dataset"
    project.mkdir()
    for name in ("one", "two"):
        Image.new("RGB", (32, 32), "white").save(project / f"{name}.png")
    workspace, _ = workspaces.open(str(project))
    assets = AssetService(workspaces).list_assets(workspace.project_id).items
    by_name = {asset.filename: asset for asset in assets}
    annotations = AnnotationService(workspaces)
    annotations.save_tags(
        workspace.project_id,
        by_name["one.png"].id,
        [AnnotationTag(name="caption"), AnnotationTag(name="subject")],
    )
    annotations.save_tags(
        workspace.project_id,
        by_name["two.png"].id,
        [
            AnnotationTag(name="caption"),
            AnnotationTag(name="subject"),
            AnnotationTag(name="garden"),
        ],
    )

    result = StatisticsService(workspaces).tag_frequency(workspace.project_id)

    assert result.analyzer == "tag_frequency"
    assert result.document_count == 2
    assert result.occurrence_count == 5
    assert [(bucket.value, bucket.count) for bucket in result.buckets] == [
        ("caption", 2),
        ("subject", 2),
        ("garden", 1),
    ]
    assert not (project / "one.txt").exists()
    assert not (project / "two.txt").exists()
