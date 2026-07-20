from pathlib import Path

import pytest
from PIL import Image

from dataset_studio.core.config import Settings
from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.assets.service import AssetService
from dataset_studio.modules.jobs.models import (
    ExistingTranslationPolicy,
    JobCreateRequest,
    JobKind,
    JobScope,
)
from dataset_studio.modules.jobs.service import JobService
from dataset_studio.modules.presets.models import ProviderProfileCreate, ProviderType
from dataset_studio.modules.presets.repository import PresetRepository
from dataset_studio.modules.presets.service import PresetService
from dataset_studio.modules.translations.models import TranslationStatus
from dataset_studio.modules.translations.service import TranslationService
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
    translations = TranslationService(workspaces)
    assets = AssetService(workspaces)
    project = tmp_path / "dataset"
    project.mkdir()
    for index, filename in enumerate(filenames):
        Image.new("RGB", (32, 32), "white" if index % 2 == 0 else "black").save(project / filename)
    workspace, _ = workspaces.open(str(project))
    asset_items = assets.list_assets(workspace.project_id).items
    return project, workspace.project_id, asset_items, workspaces, annotations, translations


def test_translation_sidecar_tracks_source_version_and_preserves_existing_file(
    tmp_path: Path,
) -> None:
    project, project_id, assets, _, annotations, translations = _translation_services(tmp_path)
    asset = assets[0]
    source = '<caption mood="quiet">a small garden</caption>'
    annotations.save(project_id, asset.id, source)
    source_hash = translations.read_source(project_id, asset.id)[1]

    missing = translations.get(project_id, asset.id, "zh-cn")
    assert missing.status == TranslationStatus.MISSING
    assert missing.language == "zh-CN"
    assert missing.path == "sample.zh-CN.txt"

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
    assert (project / "sample.txt").read_text(encoding="utf-8") == source
    assert (project / "sample.zh-CN.txt").read_text(encoding="utf-8") == (
        '<caption mood="quiet">一座小花园</caption>'
    )

    with pytest.raises(ValueError, match="标签、属性或标签顺序"):
        translations.save_generated(
            project_id,
            asset.id,
            "zh-CN",
            "<description>错误结构</description>",
            expected_source_hash=source_hash,
        )
    assert (project / "sample.zh-CN.txt").read_text(encoding="utf-8") == (
        '<caption mood="quiet">一座小花园</caption>'
    )

    (project / "sample.zh-CN.txt").write_text(
        '<caption mood="quiet">外部编辑</caption>',
        encoding="utf-8",
    )
    assert translations.get(project_id, asset.id, "zh-CN").status == TranslationStatus.UNTRACKED

    annotations.save(project_id, asset.id, '<caption mood="quiet">a larger garden</caption>')
    stale = translations.get(project_id, asset.id, "zh-CN")
    assert stale.status == TranslationStatus.STALE
    assert stale.source_hash != stale.current_source_hash


def test_translation_job_uses_annotation_selection_and_existing_policy(tmp_path: Path) -> None:
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
        annotations.save(project_id, asset.id, "<caption>source</caption>")
    source_hash = translations.read_source(project_id, by_name["current.png"].id)[1]
    translations.save_generated(
        project_id,
        by_name["current.png"].id,
        "zh-CN",
        "<caption>当前译文</caption>",
        expected_source_hash=source_hash,
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
            model="translation-model",
            models=["translation-model", "translation-quality"],
            api_key="secret",
        )
    )
    jobs = JobService(workspaces, presets, annotations, translations)
    missing_job = jobs.create(
        project_id,
        JobCreateRequest(
            provider_profile_id=provider.id,
            model="translation-quality",
            kind=JobKind.TRANSLATION,
            scope=JobScope.ALL,
            target_language="zh-CN",
            translation_policy=ExistingTranslationPolicy.SKIP,
        ),
    )
    assert missing_job.kind == JobKind.TRANSLATION
    assert missing_job.target_language == "zh-CN"
    assert missing_job.system_preset_id == "default-translation-prompt"
    assert missing_job.system_preset_name == "默认结构保留翻译"
    assert missing_job.model == "translation-quality"
    assert [item.asset_id for item in missing_job.items] == [by_name["missing.png"].id]

    annotations.save(project_id, by_name["current.png"].id, "<caption>changed</caption>")
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


def test_translation_never_treats_another_assets_annotation_as_a_sidecar(
    tmp_path: Path,
) -> None:
    (
        _,
        project_id,
        assets,
        _,
        annotations,
        translations,
    ) = _translation_services(tmp_path, ("sample.png", "sample.zh-CN.png"))
    by_name = {asset.filename: asset for asset in assets}
    annotations.save(project_id, by_name["sample.png"].id, "<caption>source</caption>")
    annotations.save(
        project_id,
        by_name["sample.zh-CN.png"].id,
        "<caption>another image annotation</caption>",
    )
    source_hash = translations.read_source(project_id, by_name["sample.png"].id)[1]

    document = translations.get(project_id, by_name["sample.png"].id, "zh-CN")
    assert document.status == TranslationStatus.CONFLICT
    assert not document.exists
    assert document.issue
    with pytest.raises(ValueError, match="另一张图片"):
        translations.save_generated(
            project_id,
            by_name["sample.png"].id,
            "zh-CN",
            "<caption>译文</caption>",
            expected_source_hash=source_hash,
        )
