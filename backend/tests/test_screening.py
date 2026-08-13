from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from dataset_studio.api.app import create_app
from dataset_studio.core.config import Settings
from dataset_studio.core.sqlite import transaction
from dataset_studio.modules.screening.repository import ScreeningRepository
from dataset_studio.modules.screening.worker import ScreeningWorker


def _write_asset(
    root: Path,
    name: str,
    metadata: dict[str, object] | str,
    *,
    color: str = "white",
) -> None:
    Image.new("RGB", (1024, 768), color).save(root / f"{name}.png")
    payload = metadata if isinstance(metadata, str) else json.dumps(metadata)
    (root / f"{name}.json").write_text(payload, encoding="utf-8")


def test_screening_api_scores_only_frozen_assets_and_isolates_bad_metadata(
    tmp_path: Path,
) -> None:
    project = tmp_path / "dataset"
    project.mkdir()
    common = {
        "rating": "s",
        "created_at": "2026-01-01T00:00:00Z",
        "metadata_snapshot_at": "2026-01-02T00:00:00Z",
        "fav_count": 10,
        "up_score": 8,
        "down_score": 0,
    }
    _write_asset(project, "good", common)
    _write_asset(project, "bad", "{not-json")
    _write_asset(project, "ignored", common | {"fav_count": 999})
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)

    with TestClient(create_app(settings)) as client:
        opened = client.post("/api/v1/workspaces/open", json={"path": str(project)})
        project_id = opened.json()["workspace"]["project_id"]
        assets = client.get(f"/api/v1/workspaces/{project_id}/assets").json()["items"]
        by_name = {asset["filename"]: asset["id"] for asset in assets}
        request = {
            "asset_ids": [by_name["good.png"], by_name["bad.png"]],
            "task_profile": "character_lora",
            "intensity": "balanced",
        }
        naive_snapshot = client.post(
            f"/api/v1/workspaces/{project_id}/screening/operations",
            json=request | {"metadata_snapshot_at": "2026-01-02T00:00:00"},
        )
        assert naive_snapshot.status_code == 422
        created = client.post(
            f"/api/v1/workspaces/{project_id}/screening/operations",
            json=request,
        )
        assert created.status_code == 201
        operation_id = created.json()["id"]
        active = client.get("/api/v1/jobs/active")
        assert active.json()["screening_count"] == 1
        blocked_scan = client.post(f"/api/v1/workspaces/{project_id}/scan")
        assert blocked_scan.status_code == 400
        assert "正在筛选" in blocked_scan.json()["detail"]
        container = client.app.state.container
        claimed = ScreeningWorker(container)._claim_next()
        assert claimed is not None
        ScreeningWorker(container)._process_operation(project_id, operation_id)

        operation = client.get(
            f"/api/v1/workspaces/{project_id}/screening/operations/{operation_id}"
        ).json()
        listed = client.get(
            f"/api/v1/workspaces/{project_id}/screening/operations/{operation_id}/items"
        ).json()
        selected = client.get(
            f"/api/v1/workspaces/{project_id}/screening/operations/{operation_id}/asset-ids"
        ).json()

    assert operation["status"] == "completed"
    assert operation["score_mode"] == "batch_only_v0_1"
    assert "asset_ids" not in operation["configuration_snapshot"]
    assert operation["total_items"] == 2
    assert operation["scored_items"] == 1
    assert operation["invalid_items"] == 1
    assert selected["total"] == 2
    assert by_name["ignored.png"] not in selected["ids"]
    items = {item["asset_id"]: item for item in listed["items"]}
    assert items[by_name["good.png"]]["candidate_pool"] == "review"
    assert "SMALL_RATING_COHORT_REVIEW" in items[by_name["good.png"]]["reason_codes"]
    assert items[by_name["bad.png"]]["candidate_pool"] == "invalid"
    assert items[by_name["bad.png"]]["error_code"] == "METADATA_INVALID_JSON"


def test_screening_missing_down_score_is_neutral_and_low_evidence_is_protected(
    tmp_path: Path,
) -> None:
    project = tmp_path / "dataset"
    project.mkdir()
    _write_asset(
        project,
        "new-post",
        {
            "rating": "g",
            "created_at": "2026-01-01T00:00:00Z",
            "metadata_snapshot_at": "2026-01-01T01:00:00Z",
            "fav_count": 0,
            "up_score": 0,
        },
    )
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    with TestClient(create_app(settings)) as client:
        project_id = client.post("/api/v1/workspaces/open", json={"path": str(project)}).json()[
            "workspace"
        ]["project_id"]
        asset_id = client.get(f"/api/v1/workspaces/{project_id}/assets").json()["items"][0]["id"]
        operation_id = client.post(
            f"/api/v1/workspaces/{project_id}/screening/operations",
            json={"asset_ids": [asset_id]},
        ).json()["id"]
        container = client.app.state.container
        claimed = ScreeningWorker(container)._claim_next()
        assert claimed is not None
        ScreeningWorker(container)._process_operation(project_id, operation_id)
        item = client.get(
            f"/api/v1/workspaces/{project_id}/screening/operations/{operation_id}/items/{asset_id}"
        ).json()

    assert item["candidate_pool"] == "low_evidence_protected"
    assert item["confidence_vote"] == 0.0
    assert item["score_details"]["vote_posterior_mean"] is None
    assert item["score_details"]["vote_percentile_mean"] is None
    assert item["score_details"]["vote_percentile_lower"] is None
    assert "DOWN_SCORE_MISSING_VOTE_NEUTRAL" in item["warnings"]


def test_screening_excludes_danbooru_invalid_and_quarantine_items_from_ranking(
    tmp_path: Path,
) -> None:
    project = tmp_path / "dataset"
    project.mkdir()
    base = {
        "rating": "g",
        "created_at": "2026-01-01T00:00:00Z",
        "metadata_snapshot_at": "2026-01-02T00:00:00Z",
        "fav_count": 3,
        "up_score": 2,
        "down_score": 0,
    }
    _write_asset(project, "valid", base)
    _write_asset(project, "deleted", base | {"is_deleted": True, "fav_count": 999})
    _write_asset(project, "pending", base | {"is_pending": True, "fav_count": 999})
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)

    with TestClient(create_app(settings)) as client:
        project_id = client.post("/api/v1/workspaces/open", json={"path": str(project)}).json()[
            "workspace"
        ]["project_id"]
        assets = client.get(f"/api/v1/workspaces/{project_id}/assets").json()["items"]
        by_name = {asset["filename"]: asset["id"] for asset in assets}
        operation_id = client.post(
            f"/api/v1/workspaces/{project_id}/screening/operations",
            json={"asset_ids": list(by_name.values())},
        ).json()["id"]
        container = client.app.state.container
        assert ScreeningWorker(container)._claim_next() is not None
        ScreeningWorker(container)._process_operation(project_id, operation_id)
        listed = client.get(
            f"/api/v1/workspaces/{project_id}/screening/operations/{operation_id}/items",
            params={"sort": "path"},
        ).json()

    items = {Path(item["source_relative_path"]).name: item for item in listed["items"]}
    assert items["valid.png"]["status"] == "scored"
    assert items["valid.png"]["rating_percentile"] == pytest.approx(0.5)
    assert items["deleted.png"]["candidate_pool"] == "invalid"
    assert items["deleted.png"]["error_code"] == "DANBOORU_INVALID"
    assert items["pending.png"]["candidate_pool"] == "quarantine"
    assert items["pending.png"]["error_code"] == "DANBOORU_QUARANTINE"


def test_invalid_and_quarantine_rows_do_not_pollute_the_complete_rating_cdf(
    tmp_path: Path,
) -> None:
    project = tmp_path / "dataset"
    project.mkdir()
    base = {
        "rating": "g",
        "created_at": "2026-01-01T00:00:00Z",
        "metadata_snapshot_at": "2026-01-10T00:00:00Z",
        "down_score": 0,
    }
    for index in range(20):
        _write_asset(
            project,
            f"valid-{index:02d}",
            base | {"fav_count": 100 + index, "up_score": 100 + index},
        )
    _write_asset(
        project,
        "deleted-outlier",
        base | {"fav_count": 1_000_000, "up_score": 1_000_000, "is_deleted": True},
    )
    _write_asset(
        project,
        "pending-outlier",
        base | {"fav_count": 2_000_000, "up_score": 2_000_000, "is_pending": True},
    )
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)

    with TestClient(create_app(settings)) as client:
        project_id = client.post("/api/v1/workspaces/open", json={"path": str(project)}).json()[
            "workspace"
        ]["project_id"]
        asset_ids = [
            asset["id"]
            for asset in client.get(f"/api/v1/workspaces/{project_id}/assets").json()["items"]
        ]
        operation_id = client.post(
            f"/api/v1/workspaces/{project_id}/screening/operations",
            json={"asset_ids": asset_ids},
        ).json()["id"]
        container = client.app.state.container
        assert ScreeningWorker(container)._claim_next() is not None
        ScreeningWorker(container)._process_operation(project_id, operation_id)
        listed = client.get(
            f"/api/v1/workspaces/{project_id}/screening/operations/{operation_id}/items",
            params={"sort": "path", "limit": 100, "show_duplicates": "true"},
        ).json()["items"]

    items = {Path(item["source_relative_path"]).stem: item for item in listed}
    assert items["valid-00"]["rating_percentile"] == pytest.approx(0.5 / 20)
    assert items["valid-19"]["rating_percentile"] == pytest.approx(19.5 / 20)
    assert items["deleted-outlier"]["rating_percentile"] is None
    assert items["pending-outlier"]["rating_percentile"] is None


def test_metadata_batch_is_atomic_and_resume_processes_only_pending_rows(tmp_path: Path) -> None:
    project = tmp_path / "dataset"
    project.mkdir()
    metadata = {
        "rating": "g",
        "created_at": "2026-01-01T00:00:00Z",
        "metadata_snapshot_at": "2026-01-10T00:00:00Z",
        "fav_count": 100,
        "up_score": 100,
        "down_score": 0,
    }
    for index in range(3):
        _write_asset(project, f"sample-{index}", metadata | {"fav_count": 100 + index})
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)

    with TestClient(create_app(settings)) as client:
        project_id = client.post("/api/v1/workspaces/open", json={"path": str(project)}).json()[
            "workspace"
        ]["project_id"]
        asset_ids = [
            asset["id"]
            for asset in client.get(f"/api/v1/workspaces/{project_id}/assets").json()["items"]
        ]
        operation_id = client.post(
            f"/api/v1/workspaces/{project_id}/screening/operations",
            json={"asset_ids": asset_ids},
        ).json()["id"]
        container = client.app.state.container
        paths, _ = container.workspaces.get(project_id)
        repository = ScreeningRepository(paths.database)
        pending = repository.pending_rows(operation_id)
        first_update = ScreeningWorker._metadata_update(
            pending[0], root=paths.root, fallback_snapshot_at=None
        )
        second_update = ScreeningWorker._metadata_update(
            pending[1], root=paths.root, fallback_snapshot_at=None
        )
        repository.save_metadata_batch(
            operation_id,
            [first_update],
            current_relative_path=str(pending[0]["source_relative_path"]),
        )

        # A stale item makes the whole second transaction fail. The still-pending
        # second row must therefore remain untouched instead of being half-written.
        with pytest.raises(RuntimeError, match="实际更新 1 项"):
            repository.save_metadata_batch(
                operation_id,
                [first_update, second_update],
                current_relative_path=str(pending[1]["source_relative_path"]),
            )
        assert len(repository.pending_rows(operation_id)) == 2
        assert repository.get(operation_id).processed_items == 1  # type: ignore[union-attr]

        stopped = client.post(
            f"/api/v1/workspaces/{project_id}/screening/operations/{operation_id}/stop"
        )
        assert stopped.json()["status"] == "stopped"
        resumed = client.post(
            f"/api/v1/workspaces/{project_id}/screening/operations/{operation_id}/resume"
        )
        assert resumed.json()["status"] == "queued"
        assert ScreeningWorker(container)._claim_next() is not None
        ScreeningWorker(container)._process_operation(project_id, operation_id)
        completed = repository.get(operation_id)

    assert completed is not None
    assert completed.status == "completed"
    assert completed.processed_items == 3
    assert completed.scored_items == 3
    assert completed.invalid_items == 0


def test_screening_filters_exact_duplicates_and_danbooru_variants(tmp_path: Path) -> None:
    project = tmp_path / "dataset"
    project.mkdir()
    base = {
        "rating": "g",
        "created_at": "2026-01-01T00:00:00Z",
        "metadata_snapshot_at": "2026-01-10T00:00:00Z",
        "fav_count": 8,
        "up_score": 6,
        "down_score": 0,
    }
    _write_asset(project, "duplicate-a", base | {"id": 1}, color="white")
    _write_asset(project, "duplicate-b", base | {"id": 2}, color="white")
    _write_asset(project, "parent", base | {"id": 100, "has_children": True}, color="red")
    _write_asset(project, "child", base | {"id": 101, "parent_id": 100}, color="blue")
    _write_asset(project, "unique", base | {"id": 200}, color="green")
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)

    with TestClient(create_app(settings)) as client:
        project_id = client.post("/api/v1/workspaces/open", json={"path": str(project)}).json()[
            "workspace"
        ]["project_id"]
        assets = client.get(f"/api/v1/workspaces/{project_id}/assets").json()["items"]
        by_name = {asset["filename"]: asset["id"] for asset in assets}
        operation_id = client.post(
            f"/api/v1/workspaces/{project_id}/screening/operations",
            json={"asset_ids": list(by_name.values())},
        ).json()["id"]
        container = client.app.state.container
        claimed = ScreeningWorker(container)._claim_next()
        assert claimed is not None
        ScreeningWorker(container)._process_operation(project_id, operation_id)

        marked = client.get(
            f"/api/v1/workspaces/{project_id}/screening/operations/{operation_id}/items",
            params={
                "duplicate_variant": "true",
                "show_duplicates": "true",
                "sort": "path",
            },
        )
        unmarked = client.get(
            f"/api/v1/workspaces/{project_id}/screening/operations/{operation_id}/asset-ids",
            params={"duplicate_variant": "false", "show_duplicates": "true"},
        )

    assert marked.status_code == 200
    marked_items = marked.json()["items"]
    assert {item["asset_id"] for item in marked_items} == {
        by_name["duplicate-a.png"],
        by_name["duplicate-b.png"],
        by_name["parent.png"],
        by_name["child.png"],
    }
    duplicate_items = [item for item in marked_items if item["pixel_duplicate_group"] is not None]
    representative = next(item for item in duplicate_items if item["duplicate_representative"])
    duplicate = next(item for item in duplicate_items if not item["duplicate_representative"])
    assert duplicate["duplicate_of_asset_id"] == representative["asset_id"]
    assert unmarked.json()["ids"] == [by_name["unique.png"]]


def test_screening_queued_operation_can_stop_resume_and_complete(tmp_path: Path) -> None:
    project = tmp_path / "dataset"
    project.mkdir()
    _write_asset(
        project,
        "sample",
        {
            "rating": "q",
            "created_at": "2026-01-01T00:00:00Z",
            "metadata_snapshot_at": "2026-01-02T00:00:00Z",
            "fav_count": 3,
            "up_score": 2,
            "down_score": 0,
        },
    )
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)

    with TestClient(create_app(settings)) as client:
        project_id = client.post("/api/v1/workspaces/open", json={"path": str(project)}).json()[
            "workspace"
        ]["project_id"]
        asset_id = client.get(f"/api/v1/workspaces/{project_id}/assets").json()["items"][0]["id"]
        operation_id = client.post(
            f"/api/v1/workspaces/{project_id}/screening/operations",
            json={"asset_ids": [asset_id]},
        ).json()["id"]

        stopped = client.post(
            f"/api/v1/workspaces/{project_id}/screening/operations/{operation_id}/stop"
        )
        assert stopped.json()["status"] == "stopped"
        resumed = client.post(
            f"/api/v1/workspaces/{project_id}/screening/operations/{operation_id}/resume"
        )
        assert resumed.json()["status"] == "queued"

        container = client.app.state.container
        claimed = ScreeningWorker(container)._claim_next()
        assert claimed is not None
        ScreeningWorker(container)._process_operation(project_id, operation_id)
        completed = client.get(
            f"/api/v1/workspaces/{project_id}/screening/operations/{operation_id}"
        )

    assert completed.json()["status"] == "completed"
    assert completed.json()["processed_items"] == 1


def test_screening_is_mutually_exclusive_with_annotation_jobs(tmp_path: Path) -> None:
    project = tmp_path / "dataset"
    project.mkdir()
    _write_asset(
        project,
        "sample",
        {
            "rating": "g",
            "created_at": "2026-01-01T00:00:00Z",
            "metadata_snapshot_at": "2026-01-02T00:00:00Z",
            "fav_count": 3,
            "up_score": 2,
            "down_score": 0,
        },
    )
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)

    with TestClient(create_app(settings)) as client:
        project_id = client.post("/api/v1/workspaces/open", json={"path": str(project)}).json()[
            "workspace"
        ]["project_id"]
        asset_id = client.get(f"/api/v1/workspaces/{project_id}/assets").json()["items"][0]["id"]
        created = client.post(
            f"/api/v1/workspaces/{project_id}/screening/operations",
            json={"asset_ids": [asset_id]},
        )
        assert created.status_code == 201

        blocked_job = client.post(
            f"/api/v1/workspaces/{project_id}/jobs",
            json={
                "kind": "annotation",
                "scope": "selected",
                "asset_ids": [asset_id],
                "provider_profile_id": "missing-profile",
            },
        )

    assert blocked_job.status_code == 400
    assert "正在筛选" in blocked_job.json()["detail"]


def test_screening_worker_does_not_claim_while_an_existing_job_is_active(tmp_path: Path) -> None:
    project = tmp_path / "dataset"
    project.mkdir()
    _write_asset(
        project,
        "sample",
        {
            "rating": "g",
            "created_at": "2026-01-01T00:00:00Z",
            "metadata_snapshot_at": "2026-01-02T00:00:00Z",
            "fav_count": 3,
            "up_score": 2,
            "down_score": 0,
        },
    )
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)

    with TestClient(create_app(settings)) as client:
        project_id = client.post("/api/v1/workspaces/open", json={"path": str(project)}).json()[
            "workspace"
        ]["project_id"]
        asset_id = client.get(f"/api/v1/workspaces/{project_id}/assets").json()["items"][0]["id"]
        operation_id = client.post(
            f"/api/v1/workspaces/{project_id}/screening/operations",
            json={"asset_ids": [asset_id]},
        ).json()["id"]
        container = client.app.state.container
        paths, _ = container.workspaces.get(project_id)
        with transaction(paths.database) as connection:
            connection.execute(
                """
                INSERT INTO jobs (
                    id, status, provider_profile_id, system_preset_id,
                    scope, overwrite_existing, configuration_snapshot, json_fields_snapshot,
                    provider_snapshot, system_prompt_snapshot,
                    user_prompt_snapshot, created_at, updated_at
                ) VALUES (
                    'conflicting-job', 'running', 'provider', 'preset',
                    'all', 0, '{}', '{}', '{}', '', '',
                    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
                )
                """
            )

        assert ScreeningWorker(container)._claim_next() is None
        operation = container.screening.get(project_id, operation_id)

    assert operation.status == "queued"
