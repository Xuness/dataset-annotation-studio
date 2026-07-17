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
        asset_id = listed.json()["items"][0]["id"]

        unconfigured_preview = client.get(
            f"/api/v1/workspaces/{project_id}/assets/{asset_id}/prompt-preview"
        )
        assert unconfigured_preview.status_code == 200
        assert unconfigured_preview.json()["configuration_issue"]

        preset = client.post(
            "/api/v1/presets/system",
            json={"name": "XML caption", "system_prompt": "Return balanced XML."},
        )
        assert preset.status_code == 201
        configured = client.patch(
            f"/api/v1/workspaces/{project_id}",
            json={
                "system_preset_id": preset.json()["id"],
                "user_prompt": "Describe this image.",
            },
        )
        assert configured.status_code == 200

        preview = client.get(f"/api/v1/workspaces/{project_id}/assets/{asset_id}/prompt-preview")
        assert preview.status_code == 200
        assert preview.json()["system_preset_name"] == "XML caption"
        assert preview.json()["system_prompt"] == "Return balanced XML."
        assert preview.json()["final_user_prompt"] == "Describe this image."
        assert preview.json()["configuration_issue"] is None

        matching_ids = client.get(
            f"/api/v1/workspaces/{project_id}/assets/ids",
            params={"search": "sample", "status": "missing"},
        )
        assert matching_ids.status_code == 200
        assert matching_ids.json() == {
            "ids": [listed.json()["items"][0]["id"]],
            "total": 1,
        }

        preprocess_request = {
            "asset_ids": [],
            "resize": {"max_edge": 128, "allow_upscale": True},
            "convert": None,
            "rename": None,
        }
        preprocess_preview = client.post(
            f"/api/v1/workspaces/{project_id}/preprocessing/preview",
            json=preprocess_request,
        )
        assert preprocess_preview.status_code == 200
        executed = client.post(
            f"/api/v1/workspaces/{project_id}/preprocessing/execute",
            json={
                "request": preprocess_request,
                "preview_token": preprocess_preview.json()["preview_token"],
                "execution": {"max_workers": 2},
            },
        )
        assert executed.status_code == 200
        assert executed.json()["status"] == "completed"
        with Image.open(project / "sample.webp") as resized:
            assert resized.size == (128, 64)
