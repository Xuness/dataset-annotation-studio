from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from dataset_studio.api.app import create_app
from dataset_studio.core.config import Settings
from dataset_studio.modules.screening.models import CharacterLoraRules, ScreeningIntensity
from dataset_studio.modules.screening.selection_policy import apply_selection_policy
from dataset_studio.modules.screening.task_profiles import (
    TaskProfileInput,
    evaluate_task_profile,
)
from dataset_studio.modules.screening.worker import ScreeningWorker


def _input(
    item_id: str,
    *,
    score: float = 0.9,
    rating: str = "g",
    tags: tuple[str, ...] | None = (),
) -> TaskProfileInput:
    return TaskProfileInput(
        item_id=item_id,
        asset_id=f"asset-{item_id}",
        source_relative_path=f"{item_id}.png",
        rating=rating,
        quality_score=score,
        task_tags=tags,
    )


def test_character_lora_task_fit_is_strong_separate_and_selectively_disabled() -> None:
    item = _input(
        "comic-crowd",
        tags=("comic", "greyscale", "lineart", "3girls", "1boy"),
    )

    enabled = evaluate_task_profile([item], CharacterLoraRules())[0]
    disabled = evaluate_task_profile(
        [item],
        CharacterLoraRules(
            comic_panel=False,
            monochrome_greyscale=False,
            lineart_sketch=False,
            crowd_3plus=False,
        ),
    )[0]

    # Visual families use a short-board minimum (0.20), while the independent
    # four-person composition factor (0.35) compounds it.
    assert enabled.task_fit_score == pytest.approx(0.07)
    assert enabled.selection_score == pytest.approx(0.063)
    assert enabled.reason_codes == (
        "TASK_COMIC_PANEL",
        "TASK_MONOCHROME_GREYSCALE",
        "TASK_LINEART_SKETCH",
        "TASK_CROWD_3PLUS",
    )
    assert enabled.matched_tags == ("1boy", "3girls", "comic", "greyscale", "lineart")
    assert disabled.task_fit_score == pytest.approx(1.0)
    assert disabled.selection_score == pytest.approx(item.quality_score)
    assert disabled.reason_codes == ()


def test_character_lora_people_count_uses_explicit_counts_not_multiple_tags() -> None:
    multiple_only = evaluate_task_profile(
        [_input("multiple", tags=("multiple_girls",))], CharacterLoraRules()
    )[0]
    explicit_three = evaluate_task_profile(
        [_input("three", tags=("2girls", "1boy"))], CharacterLoraRules()
    )[0]

    assert multiple_only.task_fit_score == pytest.approx(1.0)
    assert "TASK_CROWD_3PLUS" not in multiple_only.reason_codes
    assert explicit_three.task_fit_score == pytest.approx(0.55)
    assert explicit_three.matched_tags == ("1boy", "2girls")


def test_task_profile_ranking_is_rating_local_and_leaves_missing_tags_unavailable() -> None:
    outputs = {
        output.item_id: output
        for output in evaluate_task_profile(
            [
                _input("g-normal", score=0.6, tags=("solo",)),
                _input("g-comic", score=0.9, tags=("comic",)),
                _input("s-normal", score=0.4, rating="s", tags=("solo",)),
                _input("missing", score=1.0, tags=None),
            ],
            CharacterLoraRules(),
        )
    }

    assert outputs["g-normal"].selection_rank == 1
    assert outputs["g-normal"].selection_percentile == pytest.approx(0.75)
    assert outputs["g-comic"].selection_rank == 2
    assert outputs["g-comic"].selection_percentile == pytest.approx(0.25)
    assert outputs["s-normal"].selection_rank == 1
    assert outputs["s-normal"].selection_percentile == pytest.approx(0.5)
    assert outputs["missing"].task_fit_score is None
    assert outputs["missing"].selection_score is None
    assert outputs["missing"].reason_codes == ("TASK_TAGS_UNAVAILABLE",)


def test_task_profile_display_rank_only_ties_identical_scores() -> None:
    outputs = {
        output.item_id: output
        for output in evaluate_task_profile(
            [
                _input("higher", score=0.5000000000005),
                _input("lower", score=0.5),
            ],
            CharacterLoraRules(),
        )
    }

    assert outputs["higher"].selection_rank == 1
    assert outputs["lower"].selection_rank == 2
    assert outputs["higher"].selection_percentile == pytest.approx(0.75)
    assert outputs["lower"].selection_percentile == pytest.approx(0.25)


def test_selection_policy_uses_task_rank_without_changing_quality_score() -> None:
    inputs = [
        _input(
            f"item-{index:02d}",
            score=(0.99 if index == 19 else 0.40 + index * 0.02),
            tags=(("comic",) if index == 19 else ("solo",)),
        )
        for index in range(20)
    ]
    inputs = [replace(item, confidence_pop=0.8, bad_consensus_second=0.6) for item in inputs]
    profile_outputs = evaluate_task_profile(inputs, CharacterLoraRules())
    assigned = {
        output.item_id: output
        for output in apply_selection_policy(
            inputs,
            profile_outputs,
            intensity=ScreeningIntensity.BALANCED,
        )
    }

    assert inputs[-1].quality_score == pytest.approx(0.99)
    assert assigned["item-19"].selection_score == pytest.approx(0.198)
    assert assigned["item-19"].candidate_pool == "task_mismatch"
    assert "TASK_MISMATCH_STRONG_PENALTY" in assigned["item-19"].reason_codes
    assert assigned["item-18"].candidate_pool == "elite_candidate"


def _write_asset(root: Path, name: str, metadata: dict[str, object], *, color: str) -> None:
    Image.new("RGB", (1024, 768), color).save(root / f"{name}.png")
    (root / f"{name}.json").write_text(json.dumps(metadata), encoding="utf-8")


def test_api_reapplies_cached_task_profile_and_hides_duplicate_nonrepresentatives(
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
    _write_asset(
        project,
        "duplicate-high",
        base
        | {
            "id": 1,
            "fav_count": 100,
            "up_score": 100,
            "tag_string_general": "comic 2koma 1girl",
            "tag_string_meta": "highres",
        },
        color="white",
    )
    _write_asset(
        project,
        "duplicate-low",
        base
        | {
            "id": 2,
            "fav_count": 20,
            "up_score": 20,
            "tag_string_general": "comic 2koma 1girl",
            "tag_string_meta": "highres",
        },
        color="white",
    )
    _write_asset(
        project,
        "unique",
        base
        | {
            "id": 3,
            "fav_count": 30,
            "up_score": 30,
            "tag_string_general": "solo 1girl",
            "tag_string_meta": "highres",
        },
        color="green",
    )
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

        operation = client.get(
            f"/api/v1/workspaces/{project_id}/screening/operations/{operation_id}"
        ).json()
        collapsed = client.get(
            f"/api/v1/workspaces/{project_id}/screening/operations/{operation_id}/items",
            params={"sort": "path"},
        ).json()
        expanded = client.get(
            f"/api/v1/workspaces/{project_id}/screening/operations/{operation_id}/items",
            params={"sort": "path", "show_duplicates": "true"},
        ).json()
        collapsed_ids = client.get(
            f"/api/v1/workspaces/{project_id}/screening/operations/{operation_id}/asset-ids"
        ).json()
        before = client.get(
            f"/api/v1/workspaces/{project_id}/screening/operations/{operation_id}/items/"
            f"{by_name['duplicate-high.png']}"
        ).json()

        for sidecar in project.glob("*.json"):
            sidecar.unlink()
        reapplied = client.put(
            f"/api/v1/workspaces/{project_id}/screening/operations/{operation_id}/task-profile",
            json={
                "task_profile": "character_lora",
                "task_rules": {"comic_panel": False},
            },
        )
        after = client.get(
            f"/api/v1/workspaces/{project_id}/screening/operations/{operation_id}/items/"
            f"{by_name['duplicate-high.png']}"
        ).json()

    assert operation["task_profile_snapshot"]["profile_version"] == "character-lora-v1"
    assert operation["task_evaluated_items"] == 3
    assert operation["task_unavailable_items"] == 0
    assert collapsed["total"] == 2
    assert expanded["total"] == 3
    assert collapsed_ids["total"] == 2
    collapsed_names = {Path(item["source_relative_path"]).name for item in collapsed["items"]}
    assert collapsed_names == {"duplicate-high.png", "unique.png"}
    assert before["task_fit_score"] == pytest.approx(0.2)
    assert before["selection_score"] == pytest.approx(before["final_score"] * 0.2)
    assert reapplied.status_code == 200
    assert after["final_score"] == before["final_score"]
    assert after["rating_rank"] == before["rating_rank"]
    assert after["task_fit_score"] == pytest.approx(1.0)
    assert after["selection_score"] == pytest.approx(after["final_score"])
