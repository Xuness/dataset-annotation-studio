from __future__ import annotations

from dataclasses import dataclass

from dataset_studio.core.config import Settings
from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.assets.deletions.service import AssetDeletionService
from dataset_studio.modules.assets.service import AssetService
from dataset_studio.modules.exports.service import ExportService
from dataset_studio.modules.jobs.service import JobService
from dataset_studio.modules.jobs.traces import AnnotationTraceService
from dataset_studio.modules.preprocessing.service import PreprocessService
from dataset_studio.modules.presets.repository import PresetRepository
from dataset_studio.modules.presets.service import PresetService
from dataset_studio.modules.providers.codex_runtime import CodexRuntime
from dataset_studio.modules.statistics.service import StatisticsService
from dataset_studio.modules.tag_dictionaries.downloads.repository import (
    TagDictionaryDownloadRepository,
)
from dataset_studio.modules.tag_dictionaries.downloads.service import (
    TagDictionaryDownloadService,
)
from dataset_studio.modules.tag_dictionaries.repository import TagDictionaryRepository
from dataset_studio.modules.tag_dictionaries.service import TagDictionaryService
from dataset_studio.modules.taggers.downloads.repository import TaggerDownloadRepository
from dataset_studio.modules.taggers.downloads.service import TaggerDownloadService
from dataset_studio.modules.taggers.repository import TaggerRepository
from dataset_studio.modules.taggers.runtime import TaggerRuntime
from dataset_studio.modules.taggers.service import TaggerService
from dataset_studio.modules.translations.service import TranslationService
from dataset_studio.modules.workspaces.repository import WorkspaceRegistry
from dataset_studio.modules.workspaces.service import WorkspaceService
from dataset_studio.platform.global_store import initialize_global_database
from dataset_studio.platform.secrets import KeyringSecretStore


@dataclass(slots=True)
class AppContainer:
    settings: Settings
    workspaces: WorkspaceService
    assets: AssetService
    asset_deletions: AssetDeletionService
    annotations: AnnotationService
    translations: TranslationService
    presets: PresetService
    jobs: JobService
    annotation_traces: AnnotationTraceService
    preprocessing: PreprocessService
    exports: ExportService
    statistics: StatisticsService
    codex: CodexRuntime
    taggers: TaggerService
    tag_dictionaries: TagDictionaryService
    tag_dictionary_downloads: TagDictionaryDownloadService
    tagger_downloads: TaggerDownloadService
    tagger_runtime: TaggerRuntime

    @classmethod
    def create(cls, settings: Settings) -> AppContainer:
        settings.ensure_directories()
        global_database = settings.app_data_dir / "global.sqlite3"
        initialize_global_database(global_database)
        workspaces = WorkspaceService(settings, WorkspaceRegistry(global_database))
        annotations = AnnotationService(workspaces)
        assets = AssetService(workspaces)
        asset_deletions = AssetDeletionService(workspaces)
        secrets = KeyringSecretStore()
        presets = PresetService(PresetRepository(global_database), secrets)
        taggers = TaggerService(settings, TaggerRepository(global_database))
        tag_dictionaries = TagDictionaryService(
            settings,
            TagDictionaryRepository(global_database),
            taggers,
        )
        translations = TranslationService(workspaces, annotations, tag_dictionaries)
        tag_dictionary_downloads = TagDictionaryDownloadService(
            TagDictionaryDownloadRepository(global_database),
            tag_dictionaries,
        )
        tagger_downloads = TaggerDownloadService(
            TaggerDownloadRepository(global_database),
            taggers,
            secrets,
        )
        taggers.set_download_activity_check(tagger_downloads.repository.has_blocking_tasks)
        jobs = JobService(
            workspaces,
            presets,
            annotations,
            translations,
            taggers,
            tag_dictionaries,
        )
        codex = CodexRuntime()
        tagger_runtime = TaggerRuntime(taggers)
        exports = ExportService(workspaces)
        preprocessing = PreprocessService(
            workspaces,
            has_active_jobs=jobs.has_active,
            has_active_exports=exports.has_active,
            has_active_asset_deletions=asset_deletions.has_active,
        )
        exports.set_activity_checks(
            has_active_jobs=jobs.has_active,
            has_active_preprocessing=lambda project_id: (
                project_id in preprocessing.active_project_ids(preprocessing_only=True)
            ),
            has_active_asset_deletions=asset_deletions.has_active,
        )
        return cls(
            settings=settings,
            workspaces=workspaces,
            assets=assets,
            asset_deletions=asset_deletions,
            annotations=annotations,
            translations=translations,
            presets=presets,
            jobs=jobs,
            annotation_traces=AnnotationTraceService(workspaces, assets, annotations),
            preprocessing=preprocessing,
            exports=exports,
            statistics=StatisticsService(workspaces),
            codex=codex,
            taggers=taggers,
            tag_dictionaries=tag_dictionaries,
            tag_dictionary_downloads=tag_dictionary_downloads,
            tagger_downloads=tagger_downloads,
            tagger_runtime=tagger_runtime,
        )

    async def aclose(self) -> None:
        self.preprocessing.close()
        self.tagger_runtime.close()
        await self.codex.close()
