from __future__ import annotations

import hashlib
import json
from pathlib import Path

from fastapi.testclient import TestClient

from dataset_studio.api.app import create_app
from dataset_studio.core.config import Settings
from dataset_studio.modules.tokenization.models import (
    TokenCountItem,
    TokenCountRequest,
    TokenizationProfileId,
)
from dataset_studio.modules.tokenization.service import BuiltinTokenizerService

SERVICE = BuiltinTokenizerService()


def metric_counts(profile_id: TokenizationProfileId, text: str) -> dict[str, int]:
    response = SERVICE.count(
        TokenCountRequest(
            profile_id=profile_id,
            items=[TokenCountItem(id="text", text=text)],
        )
    )
    return {metric.metric_id: metric.count for metric in response.items[0].metrics}


def test_builtin_profiles_expose_training_specific_metrics() -> None:
    profiles = SERVICE.list_profiles()

    assert [profile.id for profile in profiles] == [
        TokenizationProfileId.KREA2,
        TokenizationProfileId.ANIMA,
        TokenizationProfileId.T5,
    ]
    assert [metric.short_label for metric in profiles[0].metrics] == ["Q3-VL"]
    assert [metric.short_label for metric in profiles[1].metrics] == ["Q3", "T5"]
    assert [metric.short_label for metric in profiles[2].metrics] == ["T5"]


def test_krea2_count_uses_the_training_template_effective_length() -> None:
    assert metric_counts(TokenizationProfileId.KREA2, "") == {"qwen3_vl_4b": 5}
    assert metric_counts(TokenizationProfileId.KREA2, "a quiet garden") == {"qwen3_vl_4b": 8}
    assert metric_counts(
        TokenizationProfileId.KREA2,
        "<caption>蓝发, quiet garden!</caption>",
    ) == {"qwen3_vl_4b": 16}


def test_anima_returns_qwen3_and_t5_counts_in_one_request() -> None:
    assert metric_counts(TokenizationProfileId.ANIMA, "") == {
        "qwen3_0_6b": 0,
        "t5_v1_1_xxl": 1,
    }
    assert metric_counts(TokenizationProfileId.ANIMA, "a quiet garden") == {
        "qwen3_0_6b": 3,
        "t5_v1_1_xxl": 5,
    }


def test_committed_tokenizer_assets_match_the_manifest() -> None:
    resource_root = (
        Path(__file__).parents[1]
        / "src"
        / "dataset_studio"
        / "modules"
        / "tokenization"
        / "resources"
    )
    manifest = json.loads((resource_root / "manifest.json").read_text(encoding="utf-8"))

    assert manifest["schema_version"] == 1
    assert {asset["id"] for asset in manifest["assets"]} == {
        "qwen3_0_6b",
        "qwen3_vl_4b",
        "t5_v1_1_xxl",
    }
    for asset in manifest["assets"]:
        payload = (resource_root / asset["filename"]).read_bytes()
        assert hashlib.sha256(payload).hexdigest() == asset["sha256"]
        assert asset["revision"]
        assert asset["license"] == "Apache-2.0"


def test_tokenization_api_counts_a_batch_and_rejects_duplicate_ids(tmp_path: Path) -> None:
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)

    with TestClient(create_app(settings)) as client:
        profiles = client.get("/api/v1/tokenization/profiles")
        counted = client.post(
            "/api/v1/tokenization/count",
            json={
                "profile_id": "anima",
                "items": [
                    {"id": "source", "text": "blue hair"},
                    {"id": "translated", "text": "蓝发"},
                ],
            },
        )
        duplicate = client.post(
            "/api/v1/tokenization/count",
            json={
                "profile_id": "t5",
                "items": [
                    {"id": "same", "text": "first"},
                    {"id": "same", "text": "second"},
                ],
            },
        )

    assert profiles.status_code == 200
    assert [profile["id"] for profile in profiles.json()] == ["krea2", "anima", "t5"]
    assert counted.status_code == 200
    assert counted.json()["profile"]["id"] == "anima"
    assert [item["id"] for item in counted.json()["items"]] == ["source", "translated"]
    assert duplicate.status_code == 422
