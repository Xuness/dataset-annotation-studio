import json
from pathlib import Path

import numpy as np
import pytest
from PIL import Image
from pydantic import ValidationError

from dataset_studio.core.config import Settings
from dataset_studio.modules.jobs.models import ExecutionBackend, JobCreateRequest, JobKind
from dataset_studio.modules.taggers.adapters.base import (
    TaggerVocabulary,
    ValidatedTaggerModel,
)
from dataset_studio.modules.taggers.adapters.cl_tagger_v2 import CLTaggerV2Adapter
from dataset_studio.modules.taggers.models import (
    TaggerDevice,
    TaggerImportRequest,
    TaggerInstallationStatus,
    TaggerRuntimeInfo,
    TaggerSettingsUpdate,
)
from dataset_studio.modules.taggers.registry import TaggerAdapterRegistry
from dataset_studio.modules.taggers.repository import TaggerRepository
from dataset_studio.modules.taggers.runtime import TaggerRuntime
from dataset_studio.modules.taggers.service import TaggerService
from dataset_studio.platform.global_store import initialize_global_database


class FakeTaggerAdapter:
    id = "fake_tagger"
    name = "Fake Tagger"
    description = "Test-only tagger adapter."

    def detect(self, directory: Path) -> bool:
        return (directory / "model.onnx").is_file()

    def validate(self, directory: Path) -> ValidatedTaggerModel:
        missing = [
            name
            for name in ("model.onnx", "model.onnx.data", "model_vocabulary.json")
            if not (directory / name).is_file()
        ]
        if missing:
            raise ValueError("missing: " + ", ".join(missing))
        return ValidatedTaggerModel(
            adapter_id=self.id,
            model_version="v1.0",
            tag_count=2,
            categories={"character": 1, "general": 1},
            managed_files=("model.onnx", "model.onnx.data", "model_vocabulary.json"),
        )

    def load_vocabulary(self, _directory: Path) -> TaggerVocabulary:
        return TaggerVocabulary(
            tags=("alice", "blue_hair"),
            categories=("character", "general"),
        )

    def preprocess(self, _image: Image.Image) -> np.ndarray:
        return np.zeros((1, 3, 384, 384), dtype=np.float32)

    def download_plans(self):
        return ()


class FakeSession:
    def run(self, _output_names, _input_feed):
        return [np.asarray([[2.0, 1.0]], dtype=np.float32)]

    def get_providers(self) -> list[str]:
        return ["CPUExecutionProvider"]


def _service(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TaggerService:
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    settings.ensure_directories()
    database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(database)
    monkeypatch.setattr(
        TaggerService,
        "runtime_info",
        staticmethod(
            lambda: TaggerRuntimeInfo(
                available=True,
                providers=["CPUExecutionProvider"],
                devices=[TaggerDevice.AUTO, TaggerDevice.CPU],
            )
        ),
    )
    return TaggerService(
        settings,
        TaggerRepository(database),
        TaggerAdapterRegistry((FakeTaggerAdapter(),)),
    )


def _model_source(tmp_path: Path) -> Path:
    source = tmp_path / "source-model"
    source.mkdir()
    (source / "model.onnx").write_bytes(b"graph")
    (source / "model.onnx.data").write_bytes(b"weights")
    (source / "model_vocabulary.json").write_text("{}", encoding="utf-8")
    return source


def _real_onnx_model_source(tmp_path: Path) -> Path:
    import onnx
    from onnx import TensorProto, helper, numpy_helper

    source = tmp_path / "cl-tagger-v2"
    source.mkdir()
    bias = numpy_helper.from_array(
        np.asarray([0.5, -0.5], dtype=np.float32),
        name="bias",
    )
    # Keep shape-control tensors embedded: ONNX Runtime must read them while it
    # performs graph shape inference. The actual weight tensor remains external.
    axes = helper.make_tensor("axes", TensorProto.INT64, [1], [1])
    graph = helper.make_graph(
        [
            helper.make_node(
                "ReduceMean",
                ["pixel_values"],
                ["mean"],
                axes=[1, 2, 3],
                keepdims=0,
            ),
            helper.make_node("Unsqueeze", ["mean", "axes"], ["mean_column"]),
            helper.make_node("Add", ["mean_column", "bias"], ["logits"]),
        ],
        "tiny-cl-tagger-v2",
        [helper.make_tensor_value_info("pixel_values", TensorProto.FLOAT, [1, 3, 384, 384])],
        [helper.make_tensor_value_info("logits", TensorProto.FLOAT, [1, 2])],
        initializer=[bias, axes],
    )
    model = helper.make_model(
        graph,
        opset_imports=[helper.make_opsetid("", 13)],
        ir_version=10,
    )
    onnx.save_model(
        model,
        source / "model.onnx",
        save_as_external_data=True,
        all_tensors_to_one_file=True,
        location="model.onnx.data",
        size_threshold=0,
    )
    (source / "model_vocabulary.json").write_text(
        json.dumps(
            {
                "idx_to_tag": {"0": "alice", "1": "blue_hair"},
                "tag_to_category": {"alice": 0, "blue_hair": 1},
                "categories": {"0": "character", "1": "general"},
            }
        ),
        encoding="utf-8",
    )
    (source / "model_metadata.json").write_text(
        json.dumps({"model_version": "v2.00", "num_tags": 2}),
        encoding="utf-8",
    )
    return source


def test_local_import_creates_managed_installation_and_default_profile(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _service(tmp_path, monkeypatch)
    source = _model_source(tmp_path)

    library = service.import_local(TaggerImportRequest(path=str(source), name="Test model"))

    assert len(library.installations) == 1
    installation = library.installations[0]
    assert installation.status == TaggerInstallationStatus.READY
    assert installation.name == "Test model"
    assert installation.tag_count == 2
    assert Path(installation.path).is_relative_to(Path(library.model_root))
    assert (Path(installation.path) / "installation.json").is_file()
    assert len(library.profiles) == 1
    assert library.profiles[0].ready
    assert library.profiles[0].threshold == 0.55
    assert set(library.profiles[0].categories) == {"character", "general"}
    assert service.registry.get("fake_tagger").download_plans() == ()


def test_changed_model_invalidates_old_task_snapshot_until_revalidated(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _service(tmp_path, monkeypatch)
    library = service.import_local(TaggerImportRequest(path=str(_model_source(tmp_path))))
    profile = service.resolve_execution_profile(library.profiles[0].id)
    installation = library.installations[0]
    model_path = Path(installation.path) / "model.onnx.data"
    model_path.write_bytes(b"changed-weights")

    changed = service.library().installations[0]
    assert changed.status == TaggerInstallationStatus.INVALID
    rescanned = service.rescan().installations[0]
    assert rescanned.status == TaggerInstallationStatus.INVALID
    assert rescanned.fingerprint == profile.fingerprint
    refreshed = service.validate_installation(installation.id)
    assert refreshed.status == TaggerInstallationStatus.READY
    assert refreshed.fingerprint != profile.fingerprint
    with pytest.raises(ValueError, match="发生变化"):
        service.resolve_snapshot(profile)


def test_delete_installation_removes_files_and_profiles(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _service(tmp_path, monkeypatch)
    library = service.import_local(TaggerImportRequest(path=str(_model_source(tmp_path))))
    installation = library.installations[0]
    install_path = Path(installation.path)

    deleted = service.delete_installation(installation.id)

    assert not install_path.exists()
    assert deleted.installations == []
    assert deleted.profiles == []


def test_model_root_can_change_only_while_library_is_empty(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _service(tmp_path, monkeypatch)
    custom_root = tmp_path / "custom-models"
    changed = service.update_settings(TaggerSettingsUpdate(model_root=str(custom_root)))
    assert changed.model_root == str(custom_root.resolve())
    service.import_local(TaggerImportRequest(path=str(_model_source(tmp_path))))
    with pytest.raises(ValueError, match="模型库中已有安装"):
        service.update_settings(TaggerSettingsUpdate(model_root=str(tmp_path / "other")))


def test_runtime_filters_categories_and_formats_confidence_order(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _service(tmp_path, monkeypatch)
    library = service.import_local(TaggerImportRequest(path=str(_model_source(tmp_path))))
    profile = service.resolve_execution_profile(library.profiles[0].id)
    runtime = TaggerRuntime(service, session_factory=lambda _path, _providers: FakeSession())
    monkeypatch.setattr(runtime, "_providers_for_device", lambda _device: ["CPUExecutionProvider"])
    image_path = tmp_path / "image.png"
    Image.new("RGB", (32, 16), "white").save(image_path)

    result = runtime.tag(profile, image_path)

    assert result.content == "alice, blue_hair"
    assert [tag.category for tag in result.tags] == ["character", "general"]
    assert result.provider == "CPUExecutionProvider"
    assert runtime._entries

    service.delete_installation(profile.installation_id)
    runtime.prune_missing_installations()

    assert not runtime._entries


def test_cl_tagger_v2_adapter_and_onnxruntime_execute_external_data_model(
    tmp_path: Path,
) -> None:
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    settings.ensure_directories()
    database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(database)
    service = TaggerService(
        settings,
        TaggerRepository(database),
        TaggerAdapterRegistry((CLTaggerV2Adapter(),)),
    )

    source = _real_onnx_model_source(tmp_path)
    validated = CLTaggerV2Adapter().validate(source)
    assert validated.model_version == "v2.00"
    assert validated.categories == {"character": 1, "general": 1}

    library = service.import_local(TaggerImportRequest(path=str(source), name="Tiny CL Tagger"))
    profile = service.resolve_execution_profile(library.profiles[0].id)
    profile = profile.model_copy(update={"device": TaggerDevice.CPU})
    image_path = tmp_path / "white.png"
    Image.new("RGB", (16, 24), "white").save(image_path)

    result = TaggerRuntime(service).tag(profile, image_path)

    assert result.content == "alice, blue_hair"
    assert result.provider == "CPUExecutionProvider"
    assert result.tags[0].confidence > result.tags[1].confidence > 0.55


def test_cl_tagger_vocabulary_handles_unrecognized_structured_category(tmp_path: Path) -> None:
    source = tmp_path / "vocabulary"
    source.mkdir()
    (source / "model_vocabulary.json").write_text(
        json.dumps(
            {
                "idx_to_tag": ["alice"],
                "tag_to_category": {"alice": {"unexpected": "shape"}},
            }
        ),
        encoding="utf-8",
    )

    vocabulary = CLTaggerV2Adapter().load_vocabulary(source)

    assert vocabulary.categories == ("unknown",)


def test_job_request_keeps_local_taggers_annotation_only_and_requires_a_profile() -> None:
    with pytest.raises(ValidationError, match="本地打标配置"):
        JobCreateRequest(execution_backend=ExecutionBackend.LOCAL_TAGGER)

    with pytest.raises(ValidationError, match="翻译任务只能使用"):
        JobCreateRequest(
            execution_backend=ExecutionBackend.LOCAL_TAGGER,
            tagger_profile_id="profile-1",
            kind=JobKind.TRANSLATION,
        )
