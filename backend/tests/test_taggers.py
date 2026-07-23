import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from PIL import Image
from pydantic import ValidationError

import dataset_studio.modules.taggers.pipeline as tagger_pipeline
from dataset_studio.core.config import Settings
from dataset_studio.modules.jobs.models import ExecutionBackend, JobCreateRequest, JobKind
from dataset_studio.modules.taggers.adapters.base import (
    TaggerBatchContract,
    TaggerRuntimeSpec,
    TaggerTensorSpec,
    TaggerVocabulary,
    ValidatedTaggerModel,
)
from dataset_studio.modules.taggers.adapters.cl_tagger_v2 import CLTaggerV2Adapter
from dataset_studio.modules.taggers.models import (
    TaggerDevice,
    TaggerExecutionProfile,
    TaggerImportRequest,
    TaggerInferenceResult,
    TaggerInferenceTag,
    TaggerInstallationStatus,
    TaggerProfileCapabilities,
    TaggerRuntimeInfo,
    TaggerSelectionMode,
    TaggerSelectionPolicy,
    TaggerSettingsUpdate,
)
from dataset_studio.modules.taggers.pipeline import TaggerBatchPipeline, TaggerPipelineInput
from dataset_studio.modules.taggers.registry import TaggerAdapterRegistry
from dataset_studio.modules.taggers.repository import TaggerRepository
from dataset_studio.modules.taggers.runtime import TaggerRuntime, _nvidia_dll_directories
from dataset_studio.modules.taggers.service import TaggerService
from dataset_studio.platform.global_store import initialize_global_database


class FakeTaggerAdapter:
    id = "fake_tagger"
    name = "Fake Tagger"
    description = "Test-only tagger adapter."
    contract_version = 1
    discovery_markers = ("model_vocabulary.json",)

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
            adapter_contract_version=self.contract_version,
            model_version="v1.0",
            tag_count=2,
            categories={"character": 1, "general": 1},
            profile_capabilities=self.profile_capabilities(directory),
            managed_files=("model.onnx", "model.onnx.data", "model_vocabulary.json"),
        )

    def load_vocabulary(self, _directory: Path) -> TaggerVocabulary:
        return TaggerVocabulary(
            tags=("alice", "blue_hair"),
            categories=("character", "general"),
        )

    def preprocess(self, _directory: Path, _image: Image.Image) -> np.ndarray:
        return np.zeros((3, 384, 384), dtype=np.float32)

    def runtime_spec(self, _directory: Path) -> TaggerRuntimeSpec:
        return TaggerRuntimeSpec(
            backend="onnx",
            model_file="model.onnx",
            input=TaggerTensorSpec(name="pixel_values", shape=(None, 3, 384, 384)),
            outputs=(TaggerTensorSpec(name="logits", shape=(None, 2)),),
            batch=TaggerBatchContract(
                mode="dynamic",
                max_size=32,
                preferred_cpu=2,
                preferred_cuda=4,
            ),
            sample_shape=(3, 384, 384),
        )

    def profile_capabilities(self, _directory: Path) -> TaggerProfileCapabilities:
        return TaggerProfileCapabilities(
            supported_selection_modes=[TaggerSelectionMode.GLOBAL],
            default_selection=TaggerSelectionPolicy(global_threshold=0.55),
            default_categories=["character", "general"],
        )

    def collate(self, prepared, runtime_spec):
        return CLTaggerV2Adapter().collate(prepared, runtime_spec)

    def postprocess(
        self,
        outputs,
        vocabulary,
        *,
        selection,
        categories,
        provider,
        inference_ms,
    ):
        return CLTaggerV2Adapter().postprocess(
            outputs,
            vocabulary,
            selection=selection,
            categories=categories,
            provider=provider,
            inference_ms=inference_ms,
        )

    def download_plans(self):
        return ()


class FakeSession:
    def __init__(self, providers: list[str] | None = None) -> None:
        self._providers = providers or ["CPUExecutionProvider"]

    def run(self, _output_names, input_feed):
        batch_size = np.asarray(input_feed["pixel_values"]).shape[0]
        return [
            np.tile(
                np.asarray([[2.0, 1.0]], dtype=np.float32),
                (batch_size, 1),
            )
        ]

    def get_providers(self) -> list[str]:
        return self._providers

    def get_inputs(self):
        return [
            SimpleNamespace(
                name="pixel_values",
                shape=["batch", 3, 384, 384],
                type="tensor(float)",
            )
        ]

    def get_outputs(self):
        return [
            SimpleNamespace(
                name="logits",
                shape=["batch", 2],
                type="tensor(float)",
            )
        ]


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
        [
            helper.make_tensor_value_info(
                "pixel_values",
                TensorProto.FLOAT,
                ["batch", 3, 384, 384],
            )
        ],
        [helper.make_tensor_value_info("logits", TensorProto.FLOAT, ["batch", 2])],
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
    assert library.profiles[0].selection.global_threshold == 0.55
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
    monkeypatch.setattr(
        runtime,
        "_provider_candidates_for_device",
        lambda _device: [["CPUExecutionProvider"]],
    )
    image_path = tmp_path / "image.png"
    Image.new("RGB", (32, 16), "white").save(image_path)

    result = runtime.tag(profile, image_path)

    assert result.content == "alice, blue_hair"
    assert [tag.category for tag in result.tags] == ["character", "general"]
    assert result.provider == "CPUExecutionProvider"
    assert runtime._entries
    batch_session = runtime.bind(profile.model_copy(update={"batch_size": 4}))
    assert batch_session.effective_batch_size() == 4
    batch_session.record_batch_failure(4)
    assert batch_session.effective_batch_size() == 2

    service.delete_installation(profile.installation_id)
    runtime.prune_missing_installations()

    assert not runtime._entries


def test_v1_execution_snapshot_reuses_concurrency_as_requested_batch_size() -> None:
    profile = TaggerExecutionProfile.model_validate(
        {
            "snapshot_version": 1,
            "id": "legacy",
            "name": "Legacy profile",
            "installation_id": "installation",
            "installation_name": "Model",
            "adapter_id": "fake",
            "model_version": "v1",
            "fingerprint": "a" * 64,
            "threshold": 0.55,
            "categories": ["general"],
            "device": "cpu",
            "concurrency": 3,
        }
    )

    assert profile.snapshot_version == 1
    assert profile.batch_size == 3
    assert profile.selection == TaggerSelectionPolicy(global_threshold=0.55)


def test_batch_pipeline_isolates_bad_images_and_shrinks_failed_microbatches(
    tmp_path: Path,
) -> None:
    class AdaptiveSession:
        provider = "CPUExecutionProvider"
        prepared_tensor_bytes = 3 * 8 * 8 * 4

        def __init__(self) -> None:
            self.batch_calls: list[int] = []

        def effective_batch_size(self) -> int:
            return 4

        def record_batch_failure(self, failed_batch_size: int) -> None:
            assert failed_batch_size == 4

        def preprocess_bytes(self, _payload: bytes) -> np.ndarray:
            return np.zeros((3, 8, 8), dtype=np.float32)

        def infer_batch(self, prepared):
            self.batch_calls.append(len(prepared))
            if len(prepared) > 2:
                raise ValueError("simulated batch pressure")
            return [
                CLTaggerV2Adapter().postprocess(
                    [np.asarray([[2.0, 1.0]], dtype=np.float32)],
                    TaggerVocabulary(
                        tags=("alice", "blue_hair"),
                        categories=("character", "general"),
                    ),
                    selection=TaggerSelectionPolicy(global_threshold=0.55),
                    categories=("character", "general"),
                    provider=self.provider,
                    inference_ms=1.0,
                )[0]
                for _ in prepared
            ]

    class AdaptiveRuntime:
        def __init__(self, session: AdaptiveSession) -> None:
            self.session = session

        def bind(self, _profile):
            return self.session

    image_paths = [tmp_path / f"{index}.png" for index in range(5)]
    for image_path in image_paths:
        Image.new("RGB", (16, 16), "white").save(image_path)
    invalid_path = tmp_path / "invalid.png"
    invalid_path.write_text("not an image", encoding="utf-8")
    session = AdaptiveSession()
    profile = TaggerExecutionProfile(
        id="profile",
        name="Batch profile",
        installation_id="installation",
        installation_name="Model",
        adapter_id="fake",
        model_version="v1",
        fingerprint="a" * 64,
        threshold=0.55,
        categories=["character", "general"],
        device=TaggerDevice.CPU,
        concurrency=1,
        batch_size=4,
    )

    report = TaggerBatchPipeline(AdaptiveRuntime(session)).run(
        profile,
        [
            *[
                TaggerPipelineInput(key=str(index), image_path=image_path)
                for index, image_path in enumerate(image_paths)
            ],
            TaggerPipelineInput(key="invalid", image_path=invalid_path),
        ],
    )

    assert session.batch_calls == [4, 2, 2, 1]
    assert [outcome.key for outcome in report.outcomes] == [
        "0",
        "1",
        "2",
        "3",
        "4",
        "invalid",
    ]
    assert all(outcome.result is not None for outcome in report.outcomes[:-1])
    assert "无法读取待打标图片" in (report.outcomes[-1].error or "")


def test_batch_pipeline_caps_each_prepared_tensor_window(tmp_path: Path) -> None:
    class MemoryBoundSession:
        provider = "CPUExecutionProvider"
        prepared_tensor_bytes = 1024

        def __init__(self) -> None:
            self.batch_calls: list[int] = []

        def effective_batch_size(self) -> int:
            return 10

        def record_batch_failure(self, _failed_batch_size: int) -> None:
            pass

        def preprocess_bytes(self, _payload: bytes) -> np.ndarray:
            return np.zeros((3, 8, 8), dtype=np.float32)

        def infer_batch(self, prepared):
            self.batch_calls.append(len(prepared))
            return [
                TaggerInferenceResult(
                    content="blue_hair",
                    tags=[
                        TaggerInferenceTag(
                            name="blue_hair",
                            category="general",
                            confidence=0.9,
                        )
                    ],
                    provider=self.provider,
                    inference_ms=1.0,
                    batch_size=len(prepared),
                    batch_inference_ms=1.0,
                )
                for _ in prepared
            ]

    class MemoryBoundRuntime:
        def __init__(self, session: MemoryBoundSession) -> None:
            self.session = session

        def bind(self, _profile):
            return self.session

    image_paths = [tmp_path / f"memory-{index}.png" for index in range(5)]
    for image_path in image_paths:
        Image.new("RGB", (16, 16), "white").save(image_path)
    session = MemoryBoundSession()
    profile = TaggerExecutionProfile(
        id="profile",
        name="Memory profile",
        installation_id="installation",
        installation_name="Model",
        adapter_id="fake",
        model_version="v1",
        fingerprint="a" * 64,
        threshold=0.55,
        categories=["general"],
        device=TaggerDevice.CPU,
        concurrency=1,
        batch_size=10,
    )

    report = TaggerBatchPipeline(
        MemoryBoundRuntime(session),
        prepared_memory_budget=2048,
    ).run(
        profile,
        [
            TaggerPipelineInput(key=str(index), image_path=image_path)
            for index, image_path in enumerate(image_paths)
        ],
    )

    assert session.batch_calls == [2, 2, 1]
    assert all(outcome.result is not None for outcome in report.outcomes)


def test_batch_pipeline_rejects_single_images_outside_resource_budgets(
    tmp_path: Path,
) -> None:
    class GuardedSession:
        provider = "CPUExecutionProvider"
        prepared_tensor_bytes = 3 * 8 * 8 * 4

        def __init__(self) -> None:
            self.preprocess_calls = 0

        def effective_batch_size(self) -> int:
            return 1

        def record_batch_failure(self, _failed_batch_size: int) -> None:
            pass

        def preprocess_bytes(self, _payload: bytes) -> np.ndarray:
            self.preprocess_calls += 1
            return np.zeros((3, 8, 8), dtype=np.float32)

        def infer_batch(self, _prepared):
            raise AssertionError("超限图片不应进入推理。")

    class GuardedRuntime:
        def __init__(self, session: GuardedSession) -> None:
            self.session = session

        def bind(self, _profile):
            return self.session

    image_path = tmp_path / "guarded.png"
    Image.new("RGB", (16, 16), "white").save(image_path)
    profile = TaggerExecutionProfile(
        id="profile",
        name="Guarded profile",
        installation_id="installation",
        installation_name="Model",
        adapter_id="fake",
        model_version="v1",
        fingerprint="a" * 64,
        threshold=0.55,
        categories=["general"],
        device=TaggerDevice.CPU,
        concurrency=1,
        batch_size=1,
    )
    session = GuardedSession()
    input_item = TaggerPipelineInput(key="image", image_path=image_path)

    encoded_report = TaggerBatchPipeline(
        GuardedRuntime(session),
        encoded_memory_budget=image_path.stat().st_size - 1,
    ).run(profile, [input_item])
    pixel_report = TaggerBatchPipeline(
        GuardedRuntime(session),
        decode_pixel_budget=100,
    ).run(profile, [input_item])

    assert "读取上限" in (encoded_report.outcomes[0].error or "")
    assert "解码尺寸" in (pixel_report.outcomes[0].error or "")
    assert session.preprocess_calls == 0


def test_batch_pipeline_does_not_read_a_file_before_it_fits_the_window(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class WindowSession:
        provider = "CPUExecutionProvider"
        prepared_tensor_bytes = 3 * 8 * 8 * 4

        def effective_batch_size(self) -> int:
            return 1

        def record_batch_failure(self, _failed_batch_size: int) -> None:
            pass

        def preprocess_bytes(self, _payload: bytes) -> np.ndarray:
            return np.zeros((3, 8, 8), dtype=np.float32)

        def infer_batch(self, prepared):
            return [
                TaggerInferenceResult(
                    content="blue_hair",
                    tags=[],
                    provider=self.provider,
                    inference_ms=1.0,
                    batch_size=1,
                    batch_inference_ms=1.0,
                )
                for _ in prepared
            ]

    class WindowRuntime:
        def __init__(self, session: WindowSession) -> None:
            self.session = session

        def bind(self, _profile):
            return self.session

    first = tmp_path / "first.png"
    second = tmp_path / "second.png"
    Image.new("RGB", (16, 16), "white").save(first)
    Image.new("RGB", (16, 16), "black").save(second)
    session = WindowSession()
    runtime = WindowRuntime(session)
    profile = TaggerExecutionProfile(
        id="profile",
        name="Window profile",
        installation_id="installation",
        installation_name="Model",
        adapter_id="fake",
        model_version="v1",
        fingerprint="a" * 64,
        threshold=0.55,
        categories=["general"],
        device=TaggerDevice.CPU,
        concurrency=1,
        batch_size=1,
    )
    original_read = tagger_pipeline._read_bounded_payload
    reads: list[Path] = []

    def tracked_read(path: Path, budget: int) -> bytes:
        reads.append(path)
        return original_read(path, budget)

    monkeypatch.setattr(tagger_pipeline, "_read_bounded_payload", tracked_read)
    TaggerBatchPipeline(
        runtime,
        encoded_memory_budget=max(first.stat().st_size, second.stat().st_size),
    ).run(
        profile,
        [
            TaggerPipelineInput(key="first", image_path=first),
            TaggerPipelineInput(key="second", image_path=second),
        ],
    )

    assert reads == [first, second]


def test_runtime_auto_rebuilds_a_cpu_session_when_cuda_cannot_initialize(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _service(tmp_path, monkeypatch)
    library = service.import_local(TaggerImportRequest(path=str(_model_source(tmp_path))))
    profile = service.resolve_execution_profile(library.profiles[0].id)
    attempts: list[list[str]] = []

    def create_session(_path: Path, providers: list[str]) -> FakeSession:
        attempts.append(providers)
        # ONNX Runtime can return a CPU-only session after its CUDA provider
        # fails to load. AUTO must then build a deliberate CPU session.
        return FakeSession(
            ["CPUExecutionProvider"] if providers[0] == "CUDAExecutionProvider" else providers
        )

    runtime = TaggerRuntime(service, session_factory=create_session)
    monkeypatch.setattr(
        runtime,
        "_provider_candidates_for_device",
        lambda _device: [
            ["CUDAExecutionProvider", "CPUExecutionProvider"],
            ["CPUExecutionProvider"],
        ],
    )
    image_path = tmp_path / "image.png"
    Image.new("RGB", (32, 16), "white").save(image_path)

    result = runtime.tag(profile, image_path)

    assert attempts == [
        ["CUDAExecutionProvider", "CPUExecutionProvider"],
        ["CPUExecutionProvider"],
    ]
    assert result.provider == "CPUExecutionProvider"


def test_runtime_explicit_cuda_rejects_a_silent_cpu_fallback(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _service(tmp_path, monkeypatch)
    library = service.import_local(TaggerImportRequest(path=str(_model_source(tmp_path))))
    profile = service.resolve_execution_profile(library.profiles[0].id).model_copy(
        update={"device": TaggerDevice.CUDA}
    )
    runtime = TaggerRuntime(
        service,
        session_factory=lambda _path, _providers: FakeSession(["CPUExecutionProvider"]),
    )
    monkeypatch.setattr(
        runtime,
        "_provider_candidates_for_device",
        lambda _device: [["CUDAExecutionProvider", "CPUExecutionProvider"]],
    )
    image_path = tmp_path / "image.png"
    Image.new("RGB", (32, 16), "white").save(image_path)

    with pytest.raises(ValueError, match="CUDAExecutionProvider 未能启用"):
        runtime.tag(profile, image_path)


def test_runtime_explicit_cuda_rejects_a_fallback_during_inference(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class RuntimeFallbackSession(FakeSession):
        def run(self, output_names, input_feed):
            self._providers = ["CPUExecutionProvider"]
            return super().run(output_names, input_feed)

    service = _service(tmp_path, monkeypatch)
    library = service.import_local(TaggerImportRequest(path=str(_model_source(tmp_path))))
    profile = service.resolve_execution_profile(library.profiles[0].id).model_copy(
        update={"device": TaggerDevice.CUDA}
    )
    runtime = TaggerRuntime(
        service,
        session_factory=lambda _path, _providers: RuntimeFallbackSession(
            ["CUDAExecutionProvider", "CPUExecutionProvider"]
        ),
    )
    monkeypatch.setattr(
        runtime,
        "_provider_candidates_for_device",
        lambda _device: [["CUDAExecutionProvider", "CPUExecutionProvider"]],
    )
    image_path = tmp_path / "image.png"
    Image.new("RGB", (32, 16), "white").save(image_path)

    with pytest.raises(ValueError, match="CUDAExecutionProvider 在推理期间失效"):
        runtime.tag(profile, image_path)


def test_runtime_auto_accepts_a_cpu_fallback_during_inference(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class RuntimeFallbackSession(FakeSession):
        def run(self, output_names, input_feed):
            self._providers = ["CPUExecutionProvider"]
            return super().run(output_names, input_feed)

    service = _service(tmp_path, monkeypatch)
    library = service.import_local(TaggerImportRequest(path=str(_model_source(tmp_path))))
    profile = service.resolve_execution_profile(library.profiles[0].id)
    runtime = TaggerRuntime(
        service,
        session_factory=lambda _path, _providers: RuntimeFallbackSession(
            ["CUDAExecutionProvider", "CPUExecutionProvider"]
        ),
    )
    monkeypatch.setattr(
        runtime,
        "_provider_candidates_for_device",
        lambda _device: [["CUDAExecutionProvider", "CPUExecutionProvider"]],
    )
    image_path = tmp_path / "image.png"
    Image.new("RGB", (32, 16), "white").save(image_path)

    result = runtime.tag(profile, image_path)

    assert result.provider == "CPUExecutionProvider"


def test_provider_candidates_keep_operator_and_session_level_cpu_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import onnxruntime as ort

    monkeypatch.setattr(
        ort,
        "get_available_providers",
        lambda: [
            "CUDAExecutionProvider",
            "DmlExecutionProvider",
            "CPUExecutionProvider",
        ],
    )

    assert TaggerRuntime._provider_candidates_for_device(TaggerDevice.AUTO) == [
        ["CUDAExecutionProvider", "CPUExecutionProvider"],
        ["DmlExecutionProvider", "CPUExecutionProvider"],
        ["CPUExecutionProvider"],
    ]
    assert TaggerRuntime._provider_candidates_for_device(TaggerDevice.CUDA) == [
        ["CUDAExecutionProvider", "CPUExecutionProvider"]
    ]


def test_nvidia_dll_directories_discovers_wheel_bin_directories(tmp_path: Path) -> None:
    site_packages = tmp_path / "site-packages"
    package_file = site_packages / "onnxruntime" / "__init__.py"
    package_file.parent.mkdir(parents=True)
    package_file.touch()
    cudnn = site_packages / "nvidia" / "cudnn" / "bin"
    cublas = site_packages / "nvidia" / "cublas" / "bin"
    cudnn.mkdir(parents=True)
    cublas.mkdir(parents=True)

    directories = _nvidia_dll_directories(SimpleNamespace(__file__=str(package_file)))

    assert directories == [cublas, cudnn]


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
    image_paths = [tmp_path / "white-1.png", tmp_path / "white-2.png"]
    for image_path in image_paths:
        Image.new("RGB", (16, 24), "white").save(image_path)

    report = TaggerBatchPipeline(TaggerRuntime(service)).run(
        profile.model_copy(update={"batch_size": 2}),
        [
            TaggerPipelineInput(key=str(index), image_path=image_path)
            for index, image_path in enumerate(image_paths)
        ],
    )

    assert report.effective_batch_size == 2
    assert all(outcome.result is not None for outcome in report.outcomes)
    for outcome in report.outcomes:
        assert outcome.result is not None
        assert outcome.result.content == "alice, blue_hair"
        assert outcome.result.provider == "CPUExecutionProvider"
        assert outcome.result.batch_size == 2
        assert outcome.result.tags[0].confidence > outcome.result.tags[1].confidence > 0.55


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
