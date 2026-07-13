from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from dataset_studio.api.app import create_app
from dataset_studio.core.config import Settings


def test_health_open_workspace_and_list_assets(tmp_path: Path) -> None:
    project = tmp_path / "dataset"
    project.mkdir()
    Image.new("RGB", (64, 32), "white").save(project / "sample.webp")
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)

    with TestClient(create_app(settings)) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["status"] == "ok"

        opened = client.post("/api/v1/workspaces/open", json={"path": str(project)})
        assert opened.status_code == 200
        project_id = opened.json()["workspace"]["project_id"]
        listed = client.get(f"/api/v1/workspaces/{project_id}/assets")
        assert listed.status_code == 200
        assert listed.json()["items"][0]["relative_path"] == "sample.webp"

        matching_ids = client.get(
            f"/api/v1/workspaces/{project_id}/assets/ids",
            params={"search": "sample", "status": "missing"},
        )
        assert matching_ids.status_code == 200
        assert matching_ids.json() == {
            "ids": [listed.json()["items"][0]["id"]],
            "total": 1,
        }
