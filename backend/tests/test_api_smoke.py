from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from dataset_studio.api.app import create_app
from dataset_studio.core.config import Settings
from dataset_studio.core.errors import SecretStoreUnavailableError
from dataset_studio.platform.secrets import KeyringSecretStore


def test_cors_allows_only_the_selected_frontend_port(tmp_path: Path) -> None:
    settings = Settings(
        app_data_dir=tmp_path / "app-data",
        host="127.0.0.1",
        port=0,
        frontend_port=5180,
    )

    with TestClient(create_app(settings)) as client:
        allowed = client.options(
            "/health",
            headers={
                "Origin": "http://localhost:5180",
                "Access-Control-Request-Method": "GET",
            },
        )
        rejected = client.options(
            "/health",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
            },
        )

    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:5180"
    assert rejected.status_code == 400
    assert "access-control-allow-origin" not in rejected.headers


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


def test_legacy_singular_annotation_api_has_fixed_description_semantics(
    tmp_path: Path,
) -> None:
    project = tmp_path / "dataset"
    project.mkdir()
    Image.new("RGB", (32, 32), "white").save(project / "sample.png")
    (project / "sample.txt").write_text("<caption>imported</caption>", encoding="utf-8")
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)

    with TestClient(create_app(settings)) as client:
        opened = client.post("/api/v1/workspaces/open", json={"path": str(project)})
        project_id = opened.json()["workspace"]["project_id"]
        asset_id = client.get(f"/api/v1/workspaces/{project_id}/assets").json()["items"][0]["id"]
        singular_path = f"/api/v1/workspaces/{project_id}/assets/{asset_id}/annotation"

        before = client.get(singular_path)
        assert before.status_code == 200
        assert before.json()["channel"] == "description"
        assert before.json()["exists"] is False
        saved = client.put(
            singular_path,
            json={
                "content": "<caption>description</caption>",
                "expected_modified_at": None,
            },
        )
        assert saved.status_code == 200
        assert saved.json()["channel"] == "description"
        channels = client.get(
            f"/api/v1/workspaces/{project_id}/assets/{asset_id}/annotations"
        ).json()["documents"]
        assert {document["channel"] for document in channels} == {
            "existing_annotation",
            "description",
        }


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
        image_backends = client.get("/api/v1/system/image-processing/backends")
        assert image_backends.status_code == 200
        assert image_backends.json()["revision"]
        assert image_backends.json()["backends"][0]["id"] == "cpu"
        assert image_backends.json()["backends"][0]["status"] == "ready"

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

        related_jobs = client.get(
            f"/api/v1/workspaces/{project_id}/assets/{asset_id}/jobs"
        )
        assert related_jobs.status_code == 200
        assert related_jobs.json() == []

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
                "use_tags_as_context": True,
            },
        )
        assert configured.status_code == 200

        preview = client.get(f"/api/v1/workspaces/{project_id}/assets/{asset_id}/prompt-preview")
        assert preview.status_code == 200
        assert preview.json()["system_preset_name"] == "XML caption"
        assert preview.json()["system_prompt"] == "Return balanced XML."
        assert preview.json()["final_user_prompt"] == "Describe this image."
        assert preview.json()["tag_context_status"] == "unavailable"
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
        assert "版本已经变化" in stale_annotation.json()["detail"]
        tags_path = f"/api/v1/workspaces/{project_id}/assets/{asset_id}/annotations/tags"
        saved_tags = client.put(
            tags_path,
            json={
                "tags": [
                    {
                        "name": "blue_hair",
                        "category": "general",
                        "confidence": 0.95,
                        "origin": "tagger",
                    }
                ],
                "expected_head_revision_id": None,
            },
        )
        assert saved_tags.status_code == 200
        assert saved_tags.json()["availability_status"] == "usable"
        assert saved_tags.json()["review_status"] == "unreviewed"
        edited_tags = client.put(
            tags_path,
            json={
                "tags": [
                    {
                        "name": "blue_hair",
                        "category": "general",
                        "confidence": 0.95,
                        "origin": "tagger",
                    },
                    {
                        "name": "alice",
                        "category": "character",
                        "confidence": None,
                        "origin": "manual",
                    },
                ],
                "expected_head_revision_id": saved_tags.json()["head_revision_id"],
                "review": False,
            },
        )
        assert edited_tags.status_code == 200
        assert edited_tags.json()["review_status"] == "unreviewed"
        assisted_preview = client.get(
            f"/api/v1/workspaces/{project_id}/assets/{asset_id}/prompt-preview"
        )
        assert assisted_preview.json()["tag_line"] == 'tags: ["blue_hair","alice"]'
        assert assisted_preview.json()["final_user_prompt"] == (
            'Describe this image.\n\ntags: ["blue_hair","alice"]'
        )
        batch_options = client.post(
            f"/api/v1/workspaces/{project_id}/annotations/options",
            json={"asset_ids": [asset_id]},
        )
        assert batch_options.status_code == 200
        assert {
            (item["channel"], item["language"]) for item in batch_options.json()["targets"]
        } == {("description", None), ("tags", None)}
        batch_reviewed = client.post(
            f"/api/v1/workspaces/{project_id}/annotations/review",
            json={
                "asset_ids": [asset_id],
                "targets": [
                    {"channel": "tags", "language": ""},
                    {"channel": "description", "language": ""},
                ],
            },
        )
        assert batch_reviewed.status_code == 200
        assert batch_reviewed.json()["target_count"] == 2
        assert batch_reviewed.json()["reviewed_count"] == 2
        batch_deleted = client.post(
            f"/api/v1/workspaces/{project_id}/annotations/delete",
            json={
                "asset_ids": [asset_id],
                "targets": [
                    {"channel": "tags", "language": ""},
                    {"channel": "description", "language": ""},
                ],
            },
        )
        assert batch_deleted.status_code == 200
        assert batch_deleted.json()["target_count"] == 2
        assert batch_deleted.json()["deleted_count"] == 2

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
        execution_plan = client.post(
            f"/api/v1/workspaces/{project_id}/preprocessing/execution-plan",
            json={
                "request": preprocess_request,
                "preview_token": preprocess_preview.json()["preview_token"],
                "execution": {"mode": "cpu_only", "max_workers": 2},
            },
        )
        assert execution_plan.status_code == 200
        assert execution_plan.json()["selected_backend_id"] == "cpu"
        assert execution_plan.json()["route_counts"] == {"cpu": 1}
        assert execution_plan.json()["effective_cpu_workers"] == 1
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
        assert executed.json()["item_count"] == 1
        assert executed.json()["completed_items"] == 1
        assert executed.json()["eta_seconds"] is None
        assert executed.json()["options"]["resize"]["algorithm"] == "lanczos4"
        assert executed.json()["execution"]["mode"] == "cpu_only"
        assert executed.json()["runtime"]["route_counts"] == {"cpu": 1}
        with Image.open(project / "sample.webp") as resized:
            assert resized.size == (128, 64)
