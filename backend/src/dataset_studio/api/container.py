from __future__ import annotations

from dataclasses import dataclass

from dataset_studio.core.config import Settings
from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.assets.service import AssetService
from dataset_studio.modules.jobs.service import JobService
from dataset_studio.modules.jobs.traces import AnnotationTraceService
from dataset_studio.modules.preprocessing.service import PreprocessService
from dataset_studio.modules.presets.repository import PresetRepository
from dataset_studio.modules.presets.secrets import KeyringSecretStore
from dataset_studio.modules.presets.service import PresetService
from dataset_studio.modules.providers.codex_runtime import CodexRuntime
from dataset_studio.modules.statistics.service import StatisticsService
from dataset_studio.modules.translations.service import TranslationService
from dataset_studio.modules.workspaces.repository import WorkspaceRegistry
from dataset_studio.modules.workspaces.service import WorkspaceService
from dataset_studio.platform.global_store import initialize_global_database


@dataclass(slots=True)
class AppContainer:
    settings: Settings
    workspaces: WorkspaceService
    assets: AssetService
    annotations: AnnotationService
    translations: TranslationService
    presets: PresetService
    jobs: JobService
    annotation_traces: AnnotationTraceService
    preprocessing: PreprocessService
    statistics: StatisticsService
    codex: CodexRuntime

    @classmethod
    def create(cls, settings: Settings) -> AppContainer:
        settings.ensure_directories()
        global_database = settings.app_data_dir / "global.sqlite3"
        initialize_global_database(global_database)
        workspaces = WorkspaceService(settings, WorkspaceRegistry(global_database))
        annotations = AnnotationService(workspaces)
        translations = TranslationService(workspaces)
        assets = AssetService(workspaces)
        presets = PresetService(PresetRepository(global_database), KeyringSecretStore())
        jobs = JobService(workspaces, presets, annotations, translations)
        codex = CodexRuntime()
        return cls(
            settings=settings,
            workspaces=workspaces,
            assets=assets,
            annotations=annotations,
            translations=translations,
            presets=presets,
            jobs=jobs,
            annotation_traces=AnnotationTraceService(workspaces, assets, annotations),
            preprocessing=PreprocessService(workspaces, has_active_jobs=jobs.has_active),
            statistics=StatisticsService(workspaces),
            codex=codex,
        )

    async def aclose(self) -> None:
        await self.codex.close()
