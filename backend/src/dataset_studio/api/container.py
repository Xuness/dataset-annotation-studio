from __future__ import annotations

from dataclasses import dataclass

from dataset_studio.core.config import Settings
from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.assets.service import AssetService
from dataset_studio.modules.jobs.service import JobService
from dataset_studio.modules.preprocessing.service import PreprocessService
from dataset_studio.modules.presets.repository import PresetRepository
from dataset_studio.modules.presets.secrets import KeyringSecretStore
from dataset_studio.modules.presets.service import PresetService
from dataset_studio.modules.statistics.service import StatisticsService
from dataset_studio.modules.workspaces.repository import WorkspaceRegistry
from dataset_studio.modules.workspaces.service import WorkspaceService
from dataset_studio.platform.global_store import initialize_global_database


@dataclass(slots=True)
class AppContainer:
    settings: Settings
    workspaces: WorkspaceService
    assets: AssetService
    annotations: AnnotationService
    presets: PresetService
    jobs: JobService
    preprocessing: PreprocessService
    statistics: StatisticsService

    @classmethod
    def create(cls, settings: Settings) -> AppContainer:
        settings.ensure_directories()
        global_database = settings.app_data_dir / "global.sqlite3"
        initialize_global_database(global_database)
        workspaces = WorkspaceService(settings, WorkspaceRegistry(global_database))
        annotations = AnnotationService(workspaces)
        presets = PresetService(PresetRepository(global_database), KeyringSecretStore())
        return cls(
            settings=settings,
            workspaces=workspaces,
            assets=AssetService(workspaces),
            annotations=annotations,
            presets=presets,
            jobs=JobService(workspaces, presets, annotations),
            preprocessing=PreprocessService(workspaces),
            statistics=StatisticsService(workspaces),
        )
