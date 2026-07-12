from pathlib import Path

from PIL import Image

from dataset_studio.core.config import Settings
from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.jobs.models import JobCreateRequest, JobScope
from dataset_studio.modules.jobs.service import JobService
from dataset_studio.modules.presets.models import (
    ProviderProfileCreate,
    ProviderType,
    SystemPresetCreate,
)
from dataset_studio.modules.presets.repository import PresetRepository
from dataset_studio.modules.presets.service import PresetService
from dataset_studio.modules.workspaces.repository import WorkspaceRegistry
from dataset_studio.modules.workspaces.service import WorkspaceService
from dataset_studio.platform.global_store import initialize_global_database


class MemorySecrets:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    def get(self, key: str) -> str | None:
        return self.values.get(key)

    def set(self, key: str, value: str) -> None:
        self.values[key] = value

    def delete(self, key: str) -> None:
        self.values.pop(key, None)


def test_job_creation_skips_existing_txt_and_snapshots_presets(tmp_path: Path) -> None:
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    settings.ensure_directories()
    global_database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(global_database)
    workspaces = WorkspaceService(settings, WorkspaceRegistry(global_database))
    annotations = AnnotationService(workspaces)
    presets = PresetService(PresetRepository(global_database), MemorySecrets())
    jobs = JobService(workspaces, presets, annotations)

    project = tmp_path / "dataset"
    project.mkdir()
    Image.new("RGB", (32, 32), "white").save(project / "already.png")
    Image.new("RGB", (32, 32), "black").save(project / "pending.png")
    (project / "already.txt").write_text("<done />", encoding="utf-8")
    workspace, _ = workspaces.open(str(project))
    system = presets.create_system(
        SystemPresetCreate(name="XML caption", system_prompt="Return balanced tags.")
    )
    provider = presets.create_provider(
        ProviderProfileCreate(
            name="OpenRouter",
            provider_type=ProviderType.OPENROUTER,
            base_url="https://openrouter.ai/api/v1",
            model="example/model",
            api_key="secret",
        )
    )

    job = jobs.create(
        workspace.project_id,
        JobCreateRequest(
            system_preset_id=system.id,
            provider_profile_id=provider.id,
            scope=JobScope.ALL,
        ),
    )

    assert job.total == 1
    assert job.items[0].relative_path == "pending.png"
    assert job.system_preset_name == "XML caption"
    assert job.provider_profile_name == "OpenRouter"
    assert jobs.active_overview().count == 1
    assert jobs.active_overview().project_count == 1
    assert jobs.stop_all_workspaces() == 1
