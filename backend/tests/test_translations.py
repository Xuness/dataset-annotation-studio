from pathlib import Path

import pytest
from PIL import Image

from dataset_studio.core.config import Settings
from dataset_studio.modules.annotations.models import AnnotationChannel
from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.assets.service import AssetService
from dataset_studio.modules.jobs.execution_repository import JobExecutionRepository
from dataset_studio.modules.jobs.lifecycle_repository import JobLifecycleRepository
from dataset_studio.modules.jobs.models import (
    ExistingTranslationPolicy,
    JobCreateRequest,
    JobItemStatus,
    JobKind,
    JobScope,
)
from dataset_studio.modules.jobs.service import JobService
from dataset_studio.modules.presets.models import ProviderProfileCreate
from dataset_studio.modules.presets.repository import PresetRepository
from dataset_studio.modules.presets.service import PresetService
from dataset_studio.modules.providers.config import (
    OpenAICompatibleModelOptions,
    ProviderModelConfig,
    ProviderType,
)
from dataset_studio.modules.translations.models import TranslationStatus
from dataset_studio.modules.translations.service import (
    TranslationService,
    TranslationSourceChangedError,
)
from dataset_studio.modules.workspaces.repository import WorkspaceRegistry
from dataset_studio.modules.workspaces.service import WorkspaceService
from dataset_studio.platform.global_store import initialize_global_database
from test_jobs import MemorySecrets


def _translation_services(tmp_path: Path, filenames: tuple[str, ...] = ("sample.png",)):
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    settings.ensure_directories()
    global_database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(global_database)
    workspaces = WorkspaceService(settings, WorkspaceRegistry(global_database))
    annotations = AnnotationService(workspaces)
    translations = TranslationService(workspaces, annotations)
    assets = AssetService(workspaces)
    project = tmp_path / "dataset"
    project.mkdir()
    for index, filename in enumerate(filenames):
        Image.new("RGB", (32, 32), "white" if index % 2 == 0 else "black").save(project / filename)
    workspace, _ = workspaces.open(str(project))
    asset_items = assets.list_assets(workspace.project_id).items
    return project, workspace.project_id, asset_items, workspaces, annotations, translations


def _save_confirmed_source(
    annotations: AnnotationService,
    project_id: str,
    asset_id: str,
    content: str,
):
    return annotations.save_text(
        project_id,
        asset_id,
        AnnotationChannel.DESCRIPTION,
        content,
        confirm=True,
    )


def test_translation_tracks_confirmed_source_revision_without_writing_sidecars(
    tmp_path: Path,
) -> None:
    project, project_id, assets, _, annotations, translations = _translation_services(tmp_path)
    asset = assets[0]
    source = '<caption mood="quiet">a small garden</caption>'
    source_write = _save_confirmed_source(annotations, project_id, asset.id, source)
    source_revision = translations.read_source_revision(project_id, asset.id)
    assert source_revision is not None
    source_hash = source_revision[2]

    missing = translations.get(project_id, asset.id, "zh-cn")
    assert missing.status == TranslationStatus.MISSING
    assert missing.language == "zh-CN"
    assert missing.path == "数据库 · translation:zh-CN"

    saved = translations.save_generated(
        project_id,
        asset.id,
        "zh-CN",
        '<caption mood="quiet">一座小花园</caption>',
        expected_source_hash=source_hash,
        provider_profile_id="provider",
        provider_profile_name="Translator",
        model="model",
    )
    assert saved.status == TranslationStatus.CURRENT
    assert not (project / "sample.txt").exists()
    assert not (project / "sample.zh-CN.txt").exists()
    stored = annotations.get_channel(
        project_id,
        asset.id,
        AnnotationChannel.TRANSLATION,
        "zh-CN",
    )
    assert stored.content == '<caption mood="quiet">一座小花园</caption>'
    assert stored.review_status.value == "unreviewed"

    with pytest.raises(ValueError, match="标签、属性或标签顺序"):
        translations.save_generated(
            project_id,
            asset.id,
            "zh-CN",
            "<description>错误结构</description>",
            expected_source_hash=source_hash,
        )
    assert translations.get(project_id, asset.id, "zh-CN").content == stored.content

    pending_source = annotations.save_text(
        project_id,
        asset.id,
        AnnotationChannel.DESCRIPTION,
        '<caption mood="quiet">a larger garden</caption>',
        expected_head_revision_id=source_write.revision_id,
    )
    assert translations.get(project_id, asset.id, "zh-CN").status == TranslationStatus.CURRENT
    annotations.confirm(
        project_id,
        asset.id,
        AnnotationChannel.DESCRIPTION,
        pending_source.revision_id,
    )
    stale = translations.get(project_id, asset.id, "zh-CN")
    assert stale.status == TranslationStatus.STALE
    assert stale.source_hash != stale.current_source_hash


def test_manual_translation_edit_tracks_the_confirmed_source_revision(
    tmp_path: Path,
) -> None:
    _, project_id, assets, workspaces, annotations, translations = _translation_services(tmp_path)
    asset = assets[0]
    source = _save_confirmed_source(
        annotations,
        project_id,
        asset.id,
        "<caption>source</caption>",
    )

    saved = translations.save_manual(
        project_id,
        asset.id,
        "zh-cn",
        "<caption>人工译文</caption>",
        expected_head_revision_id=None,
    )

    assert saved.language == "zh-CN"
    assert translations.get(project_id, asset.id, "zh-CN").status == TranslationStatus.CURRENT

    changed = annotations.save_text(
        project_id,
        asset.id,
        AnnotationChannel.DESCRIPTION,
        "<caption>changed</caption>",
        expected_head_revision_id=source.revision_id,
    )
    assert translations.get(project_id, asset.id, "zh-CN").status == TranslationStatus.CURRENT
    annotations.confirm(
        project_id,
        asset.id,
        AnnotationChannel.DESCRIPTION,
        changed.revision_id,
    )
    assert translations.get(project_id, asset.id, "zh-CN").status == TranslationStatus.STALE
    stale_assets = AssetService(workspaces).list_assets(
        project_id,
        annotation_status="stale",
    )
    assert [item.id for item in stale_assets.items] == [asset.id]


def test_translation_requires_a_valid_confirmed_source(tmp_path: Path) -> None:
    _, project_id, assets, _, annotations, translations = _translation_services(tmp_path)
    asset = assets[0]
    annotations.save_text(
        project_id,
        asset.id,
        AnnotationChannel.DESCRIPTION,
        "<caption>broken",
        confirm=True,
    )

    assert translations.read_source(project_id, asset.id) is None
    assert (
        translations.get(project_id, asset.id, "zh-CN").status == TranslationStatus.SOURCE_INVALID
    )
    with pytest.raises(TranslationSourceChangedError, match="源标注已不存在"):
        translations.save_generated(
            project_id,
            asset.id,
            "zh-CN",
            "<caption>译文</caption>",
            expected_source_hash="0" * 64,
        )


def test_translation_job_uses_confirmed_sources_and_existing_policy(tmp_path: Path) -> None:
    (
        _,
        project_id,
        assets,
        workspaces,
        annotations,
        translations,
    ) = _translation_services(tmp_path, ("current.png", "missing.png"))
    by_name = {asset.filename: asset for asset in assets}
    for asset in assets:
        _save_confirmed_source(annotations, project_id, asset.id, "<caption>source</caption>")
    current_source = translations.read_source_revision(project_id, by_name["current.png"].id)
    assert current_source is not None
    translations.save_generated(
        project_id,
        by_name["current.png"].id,
        "zh-CN",
        "<caption>当前译文</caption>",
        expected_source_hash=current_source[2],
    )

    presets = PresetService(
        PresetRepository(tmp_path / "app-data" / "global.sqlite3"),
        MemorySecrets(),
    )
    provider = presets.create_provider(
        ProviderProfileCreate(
            name="Translator",
            provider_type=ProviderType.OPENAI_COMPATIBLE,
            base_url="https://example.invalid/v1",
            default_model_id="translation-model",
            models=[
                ProviderModelConfig(
                    model_id="translation-model",
                    protocol_options=OpenAICompatibleModelOptions(),
                ),
                ProviderModelConfig(
                    model_id="translation-quality",
                    protocol_options=OpenAICompatibleModelOptions(),
                ),
            ],
            api_key="secret",
        )
    )
    jobs = JobService(workspaces, presets, annotations, translations)
    missing_job = jobs.create(
        project_id,
        JobCreateRequest(
            provider_profile_id=provider.id,
            model_id="translation-quality",
            kind=JobKind.TRANSLATION,
            scope=JobScope.ALL,
            target_language="zh-CN",
            translation_policy=ExistingTranslationPolicy.SKIP,
        ),
    )
    assert missing_job.output_channel == AnnotationChannel.TRANSLATION
    assert [item.asset_id for item in missing_job.items] == [by_name["missing.png"].id]

    paths, _ = workspaces.get(project_id)
    failed_item = missing_job.items[0]
    frozen_source = translations.read_source_revision(project_id, failed_item.asset_id)
    assert frozen_source is not None
    execution = JobExecutionRepository(paths.database)
    attempt_id, _ = execution.start_attempt(
        failed_item.id,
        source_annotation_hash=frozen_source[2],
    )
    execution.finish_attempt(
        attempt_id,
        status="validation_failed",
        response_content="<caption>broken",
        error_message="simulated validation failure",
    )
    execution.finish_item(
        failed_item.id,
        JobItemStatus.FAILED,
        error="simulated validation failure",
        validation_status="failed",
    )
    JobLifecycleRepository(paths.database).finalize_jobs()
    jobs.manually_accept(project_id, missing_job.id, failed_item.id)
    accepted = translations.get(project_id, failed_item.asset_id, "zh-CN")
    assert accepted.model == "translation-quality"
    assert accepted.provider_profile_name == "Translator"

    current = annotations.get_channel(
        project_id,
        by_name["current.png"].id,
        AnnotationChannel.DESCRIPTION,
    )
    changed = annotations.save_text(
        project_id,
        by_name["current.png"].id,
        AnnotationChannel.DESCRIPTION,
        "<caption>changed</caption>",
        expected_head_revision_id=current.head_revision_id,
    )
    annotations.confirm(
        project_id,
        by_name["current.png"].id,
        AnnotationChannel.DESCRIPTION,
        changed.revision_id,
    )
    stale_job = jobs.create(
        project_id,
        JobCreateRequest(
            provider_profile_id=provider.id,
            kind=JobKind.TRANSLATION,
            scope=JobScope.SELECTED,
            asset_ids=[by_name["current.png"].id],
            target_language="zh-CN",
            translation_policy=ExistingTranslationPolicy.STALE,
        ),
    )
    assert [item.asset_id for item in stale_job.items] == [by_name["current.png"].id]


def test_translation_channels_are_isolated_per_asset_and_ignore_legacy_filename_collisions(
    tmp_path: Path,
) -> None:
    (
        project,
        project_id,
        assets,
        _,
        annotations,
        translations,
    ) = _translation_services(tmp_path, ("sample.png", "sample.zh-CN.png"))
    by_name = {asset.filename: asset for asset in assets}
    _save_confirmed_source(
        annotations,
        project_id,
        by_name["sample.png"].id,
        "<caption>source</caption>",
    )
    _save_confirmed_source(
        annotations,
        project_id,
        by_name["sample.zh-CN.png"].id,
        "<caption>another image annotation</caption>",
    )
    source = translations.read_source_revision(project_id, by_name["sample.png"].id)
    assert source is not None

    saved = translations.save_generated(
        project_id,
        by_name["sample.png"].id,
        "zh-CN",
        "<caption>译文</caption>",
        expected_source_hash=source[2],
    )

    assert saved.status == TranslationStatus.CURRENT
    assert saved.content == "<caption>译文</caption>"
    assert not (project / "sample.zh-CN.txt").exists()
