import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from PIL import Image

from dataset_studio.modules.taggers.adapters.anime_timm import AnimeTimmAdapter
from dataset_studio.modules.taggers.adapters.base import (
    TaggerBatchContract,
    TaggerRuntimeSpec,
    TaggerTensorSpec,
    TaggerVocabulary,
)
from dataset_studio.modules.taggers.adapters.camie_v2 import CamieV2Adapter
from dataset_studio.modules.taggers.adapters.common.multilabel import build_multilabel_results
from dataset_studio.modules.taggers.adapters.joytag import JoyTagAdapter
from dataset_studio.modules.taggers.adapters.pixai_tagger_v09 import PixAITaggerV09Adapter
from dataset_studio.modules.taggers.adapters.wd_tagger_v3 import WDTaggerV3Adapter
from dataset_studio.modules.taggers.models import (
    TaggerSelectionMode,
    TaggerSelectionPolicy,
)
from dataset_studio.modules.taggers.runtime import _validate_session_contract


def _touch_files(directory: Path, names: tuple[str, ...]) -> None:
    directory.mkdir()
    for name in names:
        (directory / name).write_bytes(b"fixture")


def test_standard_package_discovery_rules_do_not_guess_from_model_filename(
    tmp_path: Path,
) -> None:
    wd = tmp_path / "wd"
    _touch_files(wd, ("model.onnx", "selected_tags.csv"))
    (wd / "config.json").write_text(
        json.dumps(
            {
                "architecture": "swinv2_base_window8_256",
                "num_classes": 10861,
                "model_args": {"img_size": 448},
            }
        ),
        encoding="utf-8",
    )
    pixai = tmp_path / "pixai"
    _touch_files(
        pixai,
        (
            "model.onnx",
            "selected_tags.csv",
            "preprocess.json",
            "categories.json",
            "thresholds.csv",
        ),
    )
    (pixai / "meta.json").write_text(
        json.dumps({"repo_id": "pixai-labs/pixai-tagger-v0.9"}),
        encoding="utf-8",
    )
    anime = tmp_path / "anime"
    _touch_files(
        anime,
        (
            "model.onnx",
            "selected_tags.csv",
            "config.json",
            "preprocess.json",
            "categories.json",
            "thresholds.csv",
        ),
    )
    (anime / "meta.json").write_text(
        json.dumps({"model_name": "hf-hub:animetimm/caformer_b36.dbv4-full"}),
        encoding="utf-8",
    )

    assert WDTaggerV3Adapter().detect(wd)
    assert not PixAITaggerV09Adapter().detect(wd)
    assert not AnimeTimmAdapter().detect(wd)
    assert PixAITaggerV09Adapter().detect(pixai)
    assert not WDTaggerV3Adapter().detect(pixai)
    assert not AnimeTimmAdapter().detect(pixai)
    assert AnimeTimmAdapter().detect(anime)
    assert not WDTaggerV3Adapter().detect(anime)
    assert not PixAITaggerV09Adapter().detect(anime)


def test_anime_timm_vocabulary_keeps_per_tag_recommended_thresholds(
    tmp_path: Path,
) -> None:
    (tmp_path / "categories.json").write_text(
        json.dumps(
            [
                {"category": 0, "name": "general"},
                {"category": 4, "name": "character"},
                {"category": 9, "name": "rating"},
            ]
        ),
        encoding="utf-8",
    )
    (tmp_path / "selected_tags.csv").write_text(
        "tag_id,name,category,best_threshold\n"
        "1,blue_hair,0,0.37\n"
        "2,alice,4,0.82\n"
        "9999999,general,9,0.41\n",
        encoding="utf-8",
    )

    vocabulary = AnimeTimmAdapter().load_vocabulary(tmp_path)

    assert vocabulary.tags == ("blue_hair", "alice", "general")
    assert vocabulary.categories == ("general", "character", "rating")
    assert vocabulary.recommended_thresholds == (0.37, 0.82, 0.41)


def test_anime_timm_runtime_rejects_invalid_feature_dimension(tmp_path: Path) -> None:
    (tmp_path / "config.json").write_text(
        json.dumps(
            {
                "num_features": 0,
                "pretrained_cfg": {"input_size": [3, 384, 384]},
            }
        ),
        encoding="utf-8",
    )
    (tmp_path / "categories.json").write_text(
        json.dumps([{"category": 0, "name": "general"}]),
        encoding="utf-8",
    )
    (tmp_path / "selected_tags.csv").write_text(
        "tag_id,name,category,best_threshold\n1,blue_hair,0,0.37\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="num_features"):
        AnimeTimmAdapter().runtime_spec(tmp_path)


def test_camie_vocabulary_uses_index_order_and_seven_category_mapping(
    tmp_path: Path,
) -> None:
    metadata = {
        "dataset_info": {
            "tag_mapping": {
                "idx_to_tag": {"2": "rating_general", "0": "1girl", "1": "alice"},
                "tag_to_category": {
                    "1girl": "general",
                    "alice": "character",
                    "rating_general": "rating",
                },
            }
        }
    }
    (tmp_path / "camie-tagger-v2-metadata.json").write_text(
        json.dumps(metadata),
        encoding="utf-8",
    )

    vocabulary = CamieV2Adapter().load_vocabulary(tmp_path)

    assert vocabulary.tags == ("1girl", "alice", "rating_general")
    assert vocabulary.categories == ("general", "character", "rating")


def test_selection_policy_uses_per_tag_threshold_and_exclusive_rating() -> None:
    vocabulary = TaggerVocabulary(
        tags=("blue_hair", "alice", "rating_general", "rating_sensitive"),
        categories=("general", "character", "rating", "rating"),
        recommended_thresholds=(0.8, 0.9, 0.4, 0.4),
    )

    results = build_multilabel_results(
        np.asarray([[0.7, 0.95, 0.8, 0.9]], dtype=np.float32),
        vocabulary,
        selection=TaggerSelectionPolicy(
            mode=TaggerSelectionMode.MODEL_RECOMMENDED,
            global_threshold=0.5,
        ),
        categories=("general", "character", "rating"),
        provider="CPUExecutionProvider",
        inference_ms=8.0,
        exclusive_categories=frozenset({"rating"}),
    )

    result = results[0]
    assert not isinstance(result, Exception)
    assert [tag.name for tag in result.tags] == ["alice", "rating_sensitive"]
    assert result.batch_size == 1


def test_runtime_contract_validates_multi_output_types_and_shapes() -> None:
    spec = TaggerRuntimeSpec(
        backend="onnx",
        model_file="model.onnx",
        input=TaggerTensorSpec(name="input", shape=(None, 3, 512, 512)),
        outputs=(
            TaggerTensorSpec(name="refined", shape=(None, 70_527)),
            TaggerTensorSpec(name="indices", shape=(None, 256), dtype="int64"),
        ),
        batch=TaggerBatchContract(
            mode="dynamic",
            max_size=2,
            preferred_cpu=1,
            preferred_cuda=1,
        ),
        sample_shape=(3, 512, 512),
    )
    session = SimpleNamespace(
        get_inputs=lambda: [
            SimpleNamespace(
                name="input",
                shape=["batch", 3, 512, 512],
                type="tensor(float)",
            )
        ],
        get_outputs=lambda: [
            SimpleNamespace(
                name="refined",
                shape=["batch", 70_527],
                type="tensor(float)",
            ),
            SimpleNamespace(
                name="indices",
                shape=["batch", 256],
                type="tensor(int64)",
            ),
        ],
    )

    _validate_session_contract(session, spec)

    session.get_inputs = lambda: [
        SimpleNamespace(
            name="input",
            shape=[1, 3, 512, 512],
            type="tensor(float)",
        )
    ]
    with pytest.raises(ValueError, match="形状"):
        _validate_session_contract(session, spec)

    session.get_inputs = lambda: [
        SimpleNamespace(
            name="input",
            shape=["batch", 3, 512, 512],
            type="tensor(float)",
        )
    ]
    session.get_outputs = lambda: [
        SimpleNamespace(
            name="refined",
            shape=["batch", 70_527],
            type="tensor(float)",
        ),
        SimpleNamespace(
            name="indices",
            shape=["batch", 255],
            type="tensor(int64)",
        ),
    ]
    with pytest.raises(ValueError, match="形状"):
        _validate_session_contract(session, spec)


def test_runtime_spec_rejects_invalid_tensor_and_batch_contracts() -> None:
    with pytest.raises(ValueError, match="张量维度"):
        TaggerTensorSpec(name="input", shape=(None, 0))
    with pytest.raises(ValueError, match="批次维度"):
        TaggerRuntimeSpec(
            backend="onnx",
            model_file="model.onnx",
            input=TaggerTensorSpec(name="input", shape=(None, 3, 32, 32)),
            outputs=(TaggerTensorSpec(name="output", shape=(1, 10)),),
            batch=TaggerBatchContract(
                mode="dynamic",
                max_size=2,
                preferred_cpu=1,
                preferred_cuda=1,
            ),
            sample_shape=(3, 32, 32),
        )
    with pytest.raises(ValueError, match="推荐批次"):
        TaggerBatchContract(
            mode="dynamic",
            max_size=2,
            preferred_cpu=3,
            preferred_cuda=1,
        )


@pytest.mark.parametrize(
    ("adapter", "directory_name", "expected_shape"),
    [
        (WDTaggerV3Adapter(), "wd", (448, 448, 3)),
        (PixAITaggerV09Adapter(), "pixai", (3, 448, 448)),
        (JoyTagAdapter(), "joytag", (3, 448, 448)),
        (CamieV2Adapter(), "camie", (3, 512, 512)),
    ],
)
def test_fixed_preprocessors_are_float32_and_handle_transparency(
    tmp_path: Path,
    adapter,
    directory_name: str,
    expected_shape: tuple[int, ...],
) -> None:
    directory = tmp_path / directory_name
    directory.mkdir()
    image = Image.new("RGBA", (31, 17), (255, 0, 0, 0))

    prepared = adapter.preprocess(directory, image)

    assert prepared.shape == expected_shape
    assert prepared.dtype == np.float32
    assert prepared.flags.c_contiguous
