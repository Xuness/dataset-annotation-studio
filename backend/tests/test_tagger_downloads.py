from __future__ import annotations

import hashlib
from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from dataset_studio.core.config import Settings
from dataset_studio.core.errors import SecretStoreUnavailableError
from dataset_studio.modules.taggers.adapters.base import ValidatedTaggerModel
from dataset_studio.modules.taggers.downloads.models import (
    HuggingFaceProxyMode,
    HuggingFaceSettingsUpdate,
    TaggerDownloadCreate,
    TaggerDownloadStatus,
)
from dataset_studio.modules.taggers.downloads.repository import TaggerDownloadRepository
from dataset_studio.modules.taggers.downloads.service import TaggerDownloadService
from dataset_studio.modules.taggers.downloads.worker import TaggerDownloadWorker
from dataset_studio.modules.taggers.models import (
    TaggerDevice,
    TaggerProfileCapabilities,
    TaggerRuntimeInfo,
    TaggerSelectionMode,
    TaggerSelectionPolicy,
    TaggerSettingsUpdate,
)
from dataset_studio.modules.taggers.registry import TaggerAdapterRegistry
from dataset_studio.modules.taggers.repository import TaggerRepository
from dataset_studio.modules.taggers.service import TaggerService
from dataset_studio.modules.taggers.sources.base import (
    TaggerDownloadPlan,
    TaggerDownloadStopped,
    TaggerMaterializedFile,
    TaggerMaterializedModel,
    TaggerRemoteFile,
    TaggerTransferProgress,
)
from dataset_studio.platform.global_store import initialize_global_database

_MODEL_CONTENT = b"audited-tagger-weights"
_MODEL_HASH = hashlib.sha256(_MODEL_CONTENT).hexdigest()
_PLAN = TaggerDownloadPlan(
    plan_id="fake_tagger:v1",
    adapter_id="fake_tagger",
    name="Fake Tagger v1",
    model_version="v1",
    description="Tiny test download plan.",
    source_id="example/fake-tagger",
    revision="a" * 40,
    source_url="https://huggingface.co/example/fake-tagger",
    license_id="Apache-2.0",
    license_url="https://huggingface.co/example/fake-tagger/tree/" + "a" * 40,
    gated=False,
    provenance="author",
    files=(
        TaggerRemoteFile(
            remote_path="model.onnx",
            relative_path="model.onnx",
            size=len(_MODEL_CONTENT),
            sha256=_MODEL_HASH,
        ),
    ),
)


class MemorySecrets:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.get_calls: list[str] = []

    def get(self, key: str) -> str | None:
        self.get_calls.append(key)
        return self.values.get(key)

    def set(self, key: str, value: str) -> None:
        self.values[key] = value

    def delete(self, key: str) -> None:
        self.values.pop(key, None)


class FakeDownloadAdapter:
    id = "fake_tagger"
    name = "Fake Tagger"
    description = "Test-only downloaded tagger."
    contract_version = 1
    discovery_markers = ("model.onnx",)

    def detect(self, directory: Path) -> bool:
        return (directory / "model.onnx").is_file()

    def validate(self, directory: Path) -> ValidatedTaggerModel:
        model = directory / "model.onnx"
        if not model.is_file() or model.is_symlink():
            raise ValueError("missing model.onnx")
        return ValidatedTaggerModel(
            adapter_id=self.id,
            adapter_contract_version=self.contract_version,
            model_version="v1",
            tag_count=2,
            categories={"general": 2},
            profile_capabilities=TaggerProfileCapabilities(
                supported_selection_modes=[TaggerSelectionMode.GLOBAL],
                default_selection=TaggerSelectionPolicy(global_threshold=0.5),
                default_categories=["general"],
            ),
            managed_files=("model.onnx",),
        )

    def download_plans(self) -> tuple[TaggerDownloadPlan, ...]:
        return (_PLAN,)


class FakeHuggingFaceSource:
    def preflight(self, plan: TaggerDownloadPlan) -> None:
        assert plan == _PLAN

    def materialize(
        self,
        plan: TaggerDownloadPlan,
        destination: Path,
        *,
        on_progress,
        should_stop,
    ) -> TaggerMaterializedModel:
        if should_stop():
            raise TaggerDownloadStopped
        payload = destination / "payload"
        payload.mkdir(parents=True, exist_ok=True)
        model = payload / "model.onnx"
        model.write_bytes(_MODEL_CONTENT)
        stat = model.stat()
        on_progress(
            TaggerTransferProgress(
                relative_path="model.onnx",
                bytes_downloaded=len(_MODEL_CONTENT),
                bytes_total=len(_MODEL_CONTENT),
                files_completed=1,
                files_total=1,
            )
        )
        return TaggerMaterializedModel(
            directory=payload,
            files=(
                TaggerMaterializedFile(
                    relative_path="model.onnx",
                    size=stat.st_size,
                    modified_ns=stat.st_mtime_ns,
                    sha256=_MODEL_HASH,
                ),
            ),
        )


def _services(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[TaggerService, TaggerDownloadService, MemorySecrets]:
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
    registry = TaggerAdapterRegistry((FakeDownloadAdapter(),))
    taggers = TaggerService(settings, TaggerRepository(database), registry)
    secrets = MemorySecrets()
    downloads = TaggerDownloadService(
        TaggerDownloadRepository(database),
        taggers,
        secrets,
    )
    taggers.set_download_activity_check(downloads.repository.has_blocking_tasks)
    return taggers, downloads, secrets


def test_registry_exposes_six_pinned_audited_download_plans() -> None:
    plans = TaggerAdapterRegistry().download_plans()

    assert [plan.adapter_id for plan in plans] == [
        "cl_tagger_v2",
        "wd_tagger_v3",
        "pixai_tagger_v09",
        "joytag",
        "anime_timm_dbv4",
        "camie_tagger_v2",
    ]
    assert all(len(plan.revision) == 40 for plan in plans)
    assert all(plan.download_size > 0 and plan.files for plan in plans)
    assert all(plan.license_id and plan.license_url for plan in plans)
    assert all(len(file.sha256) == 64 and file.size > 0 for plan in plans for file in plan.files)


def test_download_requires_explicit_model_license_acceptance(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, downloads, _ = _services(tmp_path, monkeypatch)

    with pytest.raises(ValueError, match="许可证"):
        downloads.create(TaggerDownloadCreate(plan_id=_PLAN.plan_id))


def test_download_snapshots_do_not_read_the_secret_store(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, downloads, secrets = _services(tmp_path, monkeypatch)

    assert downloads.center().model_dump().keys() == {"offers", "tasks"}
    assert downloads.tasks() == []
    assert secrets.get_calls == []

    settings = downloads.connection_settings()

    assert settings.proxy_mode == HuggingFaceProxyMode.ENVIRONMENT
    assert len(secrets.get_calls) == 2


def test_download_task_pause_resume_and_cleanup_are_durable(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    taggers, downloads, _ = _services(tmp_path, monkeypatch)
    task = downloads.create(TaggerDownloadCreate(plan_id=_PLAN.plan_id, license_accepted=True))
    with pytest.raises(ValueError, match="未完成或可恢复"):
        taggers.update_settings(
            TaggerSettingsUpdate(model_root=str((tmp_path / "other-models").resolve()))
        )
    staging = downloads.staging_path(downloads.repository.get(task.id))
    staging.mkdir(parents=True)
    (staging / "partial").write_bytes(b"partial")

    paused = downloads.pause(task.id)
    assert paused.status == TaggerDownloadStatus.PAUSED
    resumed = downloads.resume(task.id)
    assert resumed.status == TaggerDownloadStatus.QUEUED
    paused_again = downloads.pause(task.id)
    assert paused_again.can_resume

    center = downloads.delete(task.id)
    assert center.tasks == []
    assert not staging.exists()
    moved = taggers.update_settings(
        TaggerSettingsUpdate(model_root=str((tmp_path / "other-models").resolve()))
    )
    assert moved.model_root == str((tmp_path / "other-models").resolve())


def test_worker_installs_verified_materialization_and_marks_offer_installed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    taggers, downloads, _ = _services(tmp_path, monkeypatch)
    monkeypatch.setattr(downloads, "source", FakeHuggingFaceSource)
    task = downloads.create(TaggerDownloadCreate(plan_id=_PLAN.plan_id, license_accepted=True))
    row = downloads.repository.claim_next("test-worker")
    assert row is not None

    worker = TaggerDownloadWorker(SimpleNamespace(taggers=taggers, tagger_downloads=downloads))
    worker._process(row)

    completed = downloads.repository.get(task.id)
    assert completed is not None
    assert completed["status"] == TaggerDownloadStatus.COMPLETED.value
    library = taggers.library()
    assert len(library.installations) == 1
    installation = library.installations[0]
    assert installation.source is not None
    assert installation.source.source_type == "huggingface"
    assert installation.source.plan_id == _PLAN.plan_id
    assert installation.source.revision == _PLAN.revision
    assert len(library.profiles) == 1
    assert taggers._repository.delete_profile(library.profiles[0].id)
    taggers.ensure_default_profile(installation.id)
    taggers.ensure_default_profile(installation.id)
    assert len(taggers.library().profiles) == 1
    center = downloads.center()
    assert center.offers[0].installed_installation_id == installation.id
    assert not downloads.staging_path(completed).exists()


def test_worker_honors_pause_requested_during_preflight(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    taggers, downloads, _ = _services(tmp_path, monkeypatch)
    monkeypatch.setattr(downloads, "source", FakeHuggingFaceSource)
    task = downloads.create(TaggerDownloadCreate(plan_id=_PLAN.plan_id, license_accepted=True))
    row = downloads.repository.claim_next("test-worker")
    assert row is not None
    assert downloads.active_count() == 1
    assert downloads.pause_all() == 1
    assert downloads.active_count() == 1

    worker = TaggerDownloadWorker(SimpleNamespace(taggers=taggers, tagger_downloads=downloads))
    worker._process(row)

    paused = downloads.repository.get(task.id)
    assert paused is not None
    assert paused["status"] == TaggerDownloadStatus.PAUSED.value
    assert downloads.active_count() == 0


def test_download_cleanup_failure_keeps_task_record_for_retry(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, downloads, _ = _services(tmp_path, monkeypatch)
    task = downloads.create(TaggerDownloadCreate(plan_id=_PLAN.plan_id, license_accepted=True))
    downloads.pause(task.id)

    def fail_cleanup(_row) -> None:
        raise OSError("simulated cleanup failure")

    monkeypatch.setattr(downloads, "cleanup_staging", fail_cleanup)
    with pytest.raises(OSError, match="simulated cleanup failure"):
        downloads.delete(task.id)

    assert downloads.repository.get(task.id) is not None


def test_download_staging_rejects_a_linked_download_root(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, downloads, _ = _services(tmp_path, monkeypatch)
    task = downloads.create(TaggerDownloadCreate(plan_id=_PLAN.plan_id, license_accepted=True))
    row = downloads.repository.get(task.id)
    assert row is not None
    external = tmp_path / "external-downloads"
    external.mkdir()
    downloads_root = Path(str(row["model_root"])) / ".downloads"
    try:
        downloads_root.symlink_to(external, target_is_directory=True)
    except OSError as error:
        pytest.skip(f"当前环境不能创建符号链接：{error}")

    with pytest.raises(ValueError, match="符号链接或目录联接"):
        downloads.staging_path(row)


def test_completed_download_is_not_reclassified_when_staging_cleanup_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    taggers, downloads, _ = _services(tmp_path, monkeypatch)
    monkeypatch.setattr(downloads, "source", FakeHuggingFaceSource)
    task = downloads.create(TaggerDownloadCreate(plan_id=_PLAN.plan_id, license_accepted=True))
    row = downloads.repository.claim_next("test-worker")
    assert row is not None

    def fail_cleanup(_row) -> None:
        raise RuntimeError("simulated cleanup failure")

    monkeypatch.setattr(downloads, "cleanup_staging", fail_cleanup)
    TaggerDownloadWorker(SimpleNamespace(taggers=taggers, tagger_downloads=downloads))._process(row)

    completed = downloads.repository.get(task.id)
    assert completed is not None
    assert completed["status"] == TaggerDownloadStatus.COMPLETED.value


def test_orphaned_download_can_resume_after_worker_restart(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, downloads, _ = _services(tmp_path, monkeypatch)
    task = downloads.create(TaggerDownloadCreate(plan_id=_PLAN.plan_id, license_accepted=True))
    row = downloads.repository.claim_next("worker-that-stopped")
    assert row is not None
    downloads.repository.set_phase(task.id, TaggerDownloadStatus.DOWNLOADING)

    assert downloads.repository.recover_orphaned() == 1
    interrupted = downloads.center().tasks[0]
    assert interrupted.status == TaggerDownloadStatus.INTERRUPTED
    assert interrupted.can_resume
    resumed = downloads.resume(task.id)
    assert resumed.status == TaggerDownloadStatus.QUEUED


def test_huggingface_settings_hide_credentials_and_require_custom_proxy(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, downloads, secrets = _services(tmp_path, monkeypatch)

    settings = downloads.update_connection_settings(
        HuggingFaceSettingsUpdate(
            proxy_mode=HuggingFaceProxyMode.CUSTOM,
            token="hf_test_secret",
            proxy_url="http://user:password@127.0.0.1:7890",
        )
    )
    assert settings.has_saved_token
    assert settings.has_custom_proxy
    assert settings.proxy_display == "http://127.0.0.1:7890"
    assert "hf_test_secret" not in settings.model_dump_json()
    assert "password" not in settings.model_dump_json()
    assert secrets.values

    downloads.update_connection_settings(
        HuggingFaceSettingsUpdate(
            proxy_mode=HuggingFaceProxyMode.DIRECT,
            clear_token=True,
            clear_proxy=True,
        )
    )
    with pytest.raises(ValueError, match="需要先保存代理地址"):
        downloads.update_connection_settings(
            HuggingFaceSettingsUpdate(proxy_mode=HuggingFaceProxyMode.CUSTOM)
        )
    with pytest.raises(ValidationError, match="有效的 HTTP"):
        HuggingFaceSettingsUpdate(
            proxy_mode=HuggingFaceProxyMode.CUSTOM,
            proxy_url="http://127.0.0.1:not-a-port",
        )


def test_huggingface_environment_token_survives_unavailable_keyring(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, downloads, secrets = _services(tmp_path, monkeypatch)
    monkeypatch.setenv("HF_TOKEN", "hf_environment_token")

    def unavailable(_key: str) -> str | None:
        raise SecretStoreUnavailableError("Secret Service unavailable")

    monkeypatch.setattr(secrets, "get", unavailable)

    settings = downloads.connection_settings()
    config, token_source = downloads._client_config()

    assert not settings.credential_store_available
    assert settings.credential_store_error == "Secret Service unavailable"
    assert settings.token_source == "environment"
    assert config.token == "hf_environment_token"
    assert token_source == "environment"
