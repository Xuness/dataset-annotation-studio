from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from dataset_studio.api.app import create_app
from dataset_studio.core.config import Settings
from dataset_studio.core.errors import SecretStoreUnavailableError
from dataset_studio.platform.secrets import KeyringSecretStore


def test_unavailable_credential_store_returns_service_unavailable(
    tmp_path: Path,
    monkeypatch,
) -> None:
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)

    def fail_secret_write(_self, _key: str, _value: str) -> None:
        raise SecretStoreUnavailableError("Secret Service unavailable")

    monkeypatch.setattr(KeyringSecretStore, "set", fail_secret_write)
    with TestClient(create_app(settings)) as client:
        response = client.post(
            "/api/v1/presets/providers",
            json={
                "name": "Linux provider",
                "provider_type": "openai_compatible",
                "base_url": "https://example.invalid/v1",
                "default_model_id": "example/model",
                "models": [
                    {
                        "model_id": "example/model",
                        "protocol_options": {
                            "provider_type": "openai_compatible",
                        },
                    }
                ],
                "api_key": "not-a-real-key",
            },
        )

    assert response.status_code == 503
    assert response.json() == {"detail": "Secret Service unavailable"}


def test_health_open_workspace_and_list_assets(tmp_path: Path, monkeypatch) -> None:
    project = tmp_path / "dataset"
    project.mkdir()
    Image.new("RGB", (64, 32), "white").save(project / "sample.webp")
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    monkeypatch.setattr(KeyringSecretStore, "get", lambda _self, _key: None)
    monkeypatch.setattr(
        "dataset_studio.modules.taggers.downloads.service.resolve_huggingface_login_token",
        lambda _token: (None, "anonymous"),
    )

    with TestClient(create_app(settings)) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["status"] == "ok"

        diagnostics = client.get("/api/v1/system/diagnostics")
        assert diagnostics.status_code == 200
        assert diagnostics.json() == {
            "status": "ok",
            "version": health.json()["version"],
            "app_data_dir": str(tmp_path / "app-data"),
            "log_dir": str(tmp_path / "app-data" / "logs"),
        }
        assert (tmp_path / "app-data" / "logs").is_dir()

        taggers = client.get("/api/v1/taggers")
        assert taggers.status_code == 200
        assert taggers.json()["model_root"] == str(
            (tmp_path / "app-data" / "models" / "taggers").resolve()
        )
        assert taggers.json()["installations"] == []
        assert taggers.json()["profiles"] == []
        assert [item["id"] for item in taggers.json()["supported_adapters"]] == [
            "cl_tagger_v2",
            "wd_tagger_v3",
            "pixai_tagger_v09",
            "joytag",
            "anime_timm_dbv4",
            "camie_tagger_v2",
        ]
        download_center = client.get("/api/v1/taggers/downloads")
        assert download_center.status_code == 200
        assert len(download_center.json()["offers"]) == 6
        assert download_center.json()["tasks"] == []
        assert set(download_center.json()) == {"offers", "tasks"}
        download_tasks = client.get("/api/v1/taggers/downloads/tasks")
        assert download_tasks.status_code == 200
        assert download_tasks.json() == []
        huggingface = client.get("/api/v1/taggers/huggingface")
        assert huggingface.status_code == 200
        assert huggingface.json()["token_source"] == "anonymous"

        opened = client.post("/api/v1/workspaces/open", json={"path": str(project)})
        assert opened.status_code == 200
        project_id = opened.json()["workspace"]["project_id"]
        listed = client.get(f"/api/v1/workspaces/{project_id}/assets")
        assert listed.status_code == 200
        assert listed.json()["items"][0]["relative_path"] == "sample.webp"
        asset_id = listed.json()["items"][0]["id"]

        trace = client.get(f"/api/v1/workspaces/{project_id}/assets/{asset_id}/annotation-trace")
        assert trace.status_code == 200
        assert trace.json() is None

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
        translation_presets = client.get("/api/v1/presets/translation-prompts")
        assert translation_presets.status_code == 200
        assert translation_presets.json()[0]["id"] == "default-translation-prompt"
        custom_translation_prompt = client.post(
            "/api/v1/presets/translation-prompts",
            json={
                "name": "API translation",
                "system_prompt": "Translate to {target_language}.",
            },
        )
        assert custom_translation_prompt.status_code == 201
        renamed_translation_prompt = client.patch(
            f"/api/v1/presets/translation-prompts/{custom_translation_prompt.json()['id']}",
            json={"name": "API translation updated"},
        )
        assert renamed_translation_prompt.status_code == 200
        assert renamed_translation_prompt.json()["name"] == "API translation updated"
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

        folders = client.get(f"/api/v1/workspaces/{project_id}/assets/folders")
        assert folders.status_code == 200
        assert folders.json()["items"] == [
            {
                "path": "",
                "parent_path": None,
                "name": "dataset",
                "direct_asset_count": 1,
                "descendant_asset_count": 1,
            }
        ]

        saved_annotation = client.put(
            f"/api/v1/workspaces/{project_id}/assets/{asset_id}/annotation",
            json={"content": "<caption>temporary</caption>", "expected_modified_at": None},
        )
        assert saved_annotation.status_code == 200
        stale_annotation = client.put(
            f"/api/v1/workspaces/{project_id}/assets/{asset_id}/annotation",
            json={"content": "<caption>stale</caption>", "expected_modified_at": None},
        )
        assert stale_annotation.status_code == 409
        assert "其他操作修改" in stale_annotation.json()["detail"]
        batch_deleted = client.post(
            f"/api/v1/workspaces/{project_id}/annotations/delete",
            json={"asset_ids": [asset_id]},
        )
        assert batch_deleted.status_code == 200
        assert batch_deleted.json()["deleted_count"] == 1

        deletion_preview = client.post(
            f"/api/v1/workspaces/{project_id}/asset-deletions/preview",
            json={"asset_ids": [asset_id]},
        )
        assert deletion_preview.status_code == 200
        deleted_asset = client.post(
            f"/api/v1/workspaces/{project_id}/asset-deletions/execute",
            json={
                "request": {"asset_ids": [asset_id]},
                "preview_token": deletion_preview.json()["preview_token"],
            },
        )
        assert deleted_asset.status_code == 200
        assert deleted_asset.json()["status"] == "completed"
        assert client.get(f"/api/v1/workspaces/{project_id}/assets").json()["total"] == 0
        restored_asset = client.post(
            f"/api/v1/workspaces/{project_id}/asset-deletions/operations/"
            f"{deleted_asset.json()['id']}/undo"
        )
        assert restored_asset.status_code == 200
        assert restored_asset.json()["status"] == "undone"
        assert client.get(f"/api/v1/workspaces/{project_id}/assets").json()["total"] == 1

        preprocess_request = {
            "asset_ids": [],
            "resize": {
                "max_edge": 128,
                "allow_upscale": True,
                "algorithm": "lanczos4",
            },
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
        assert executed.json()["options"]["resize"]["algorithm"] == "lanczos4"
        with Image.open(project / "sample.webp") as resized:
            assert resized.size == (128, 64)
