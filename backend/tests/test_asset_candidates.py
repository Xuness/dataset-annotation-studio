from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from dataset_studio.api.app import create_app
from dataset_studio.core.config import Settings
from dataset_studio.modules.annotations.models import AnnotationChannel
from dataset_studio.modules.assets.models import CandidateUpdateRequest
from dataset_studio.modules.assets.repository import AssetRepository
from dataset_studio.modules.assets.service import AssetService
from dataset_studio.modules.exports.models import ExportRequest, ExportScope
from dataset_studio.modules.exports.planner import _select_assets as select_export_assets
from dataset_studio.modules.jobs.models import JobScope
from dataset_studio.modules.jobs.service import JobService
from dataset_studio.modules.preprocessing.models import PreprocessRequest, ResizeOptions
from dataset_studio.modules.preprocessing.service import PreprocessService
from dataset_studio.modules.workspaces.repository import WorkspaceRegistry
from dataset_studio.modules.workspaces.service import WorkspaceService
from dataset_studio.platform.global_store import initialize_global_database


def _write_image(path: Path, color: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (128, 96), color).save(path)


def _services(tmp_path: Path):
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    settings.ensure_directories()
    global_database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(global_database)
    workspaces = WorkspaceService(settings, WorkspaceRegistry(global_database))
    return settings, workspaces, AssetService(workspaces), PreprocessService(workspaces)


def test_candidate_api_uses_empty_fallback_and_supports_explicit_all_scope(tmp_path: Path) -> None:
    project = tmp_path / "dataset"
    _write_image(project / "alpha" / "a.png", "red")
    _write_image(project / "alpha" / "b.png", "green")
    _write_image(project / "beta" / "c.png", "blue")
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)

    with TestClient(create_app(settings)) as client:
        opened = client.post("/api/v1/workspaces/open", json={"path": str(project)})
        project_id = opened.json()["workspace"]["project_id"]
        base = f"/api/v1/workspaces/{project_id}/assets"
        initial = client.get(base).json()
        by_name = {item["filename"]: item["id"] for item in initial["items"]}

        assert initial["total"] == 3
        assert client.get(f"{base}/candidates").json() == {
            "total_assets": 3,
            "candidate_count": 0,
            "effective_count": 3,
            "active": False,
        }

        added = client.patch(
            f"{base}/candidates",
            json={
                "action": "add",
                "asset_ids": [by_name["a.png"], by_name["c.png"]],
                "source_kind": "manual",
            },
        )
        assert added.status_code == 200
        assert added.json()["candidate_count"] == 2
        assert [item["filename"] for item in client.get(base).json()["items"]] == [
            "a.png",
            "c.png",
        ]
        all_items = client.get(base, params={"candidate_scope": "all"}).json()["items"]
        assert [item["filename"] for item in all_items] == ["a.png", "b.png", "c.png"]
        assert {item["filename"]: item["is_candidate"] for item in all_items} == {
            "a.png": True,
            "b.png": False,
            "c.png": True,
        }
        candidate_folders = client.get(f"{base}/folders").json()["items"]
        assert {item["path"]: item["descendant_asset_count"] for item in candidate_folders} == {
            "": 2,
            "alpha": 1,
            "beta": 1,
        }

        cleared = client.patch(
            f"{base}/candidates",
            json={"action": "clear", "asset_ids": [], "source_kind": "manual"},
        )
        assert cleared.status_code == 200
        assert cleared.json()["active"] is False
        assert client.get(base).json()["total"] == 3


def test_candidate_scope_drives_preprocess_jobs_and_export_and_survives_rescan(
    tmp_path: Path,
) -> None:
    _, workspaces, assets, preprocessing = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "candidate.png", "red")
    _write_image(project / "excluded.png", "blue")
    workspace, _ = workspaces.open(str(project))
    paths, _ = workspaces.get(workspace.project_id)
    rows = AssetRepository(paths.database).list_present_records()
    by_name = {str(row["filename"]): str(row["id"]) for row in rows}
    assets.update_candidates(
        workspace.project_id,
        CandidateUpdateRequest(
            action="add",
            asset_ids=[by_name["candidate.png"]],
            source_kind="manual",
        ),
    )

    preview = preprocessing.preview(
        workspace.project_id,
        PreprocessRequest(resize=ResizeOptions(max_edge=64)),
    )
    assert preview.total_items == 1
    assert preview.items[0].asset_id == by_name["candidate.png"]
    with pytest.raises(ValueError, match="不在候选集"):
        preprocessing.preview(
            workspace.project_id,
            PreprocessRequest(
                asset_ids=[by_name["excluded.png"]],
                resize=ResizeOptions(max_edge=64),
            ),
        )

    selected_for_job = JobService._select_annotation_assets(
        paths.database,
        JobScope.ALL,
        [],
        output_channel=AnnotationChannel.TAGS,
        overwrite_existing=True,
    )
    assert selected_for_job == [by_name["candidate.png"]]
    with pytest.raises(ValueError, match="不在候选集"):
        JobService._select_annotation_assets(
            paths.database,
            JobScope.SELECTED,
            [by_name["excluded.png"]],
            output_channel=AnnotationChannel.TAGS,
            overwrite_existing=True,
        )

    export_rows, issues = select_export_assets(
        paths.database,
        ExportRequest(scope=ExportScope.ALL, destination_path=str(tmp_path / "output")),
    )
    assert issues == []
    assert [str(row["id"]) for row in export_rows] == [by_name["candidate.png"]]
    with pytest.raises(ValueError, match="不在候选集"):
        select_export_assets(
            paths.database,
            ExportRequest(
                scope=ExportScope.SELECTED,
                asset_ids=[by_name["excluded.png"]],
                destination_path=str(tmp_path / "output"),
            ),
        )

    workspaces.rescan(workspace.project_id)
    assert assets.candidate_ids(workspace.project_id).ids == [by_name["candidate.png"]]
