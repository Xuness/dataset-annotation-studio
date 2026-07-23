import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from dataset_studio.api.app import create_app
from dataset_studio.core.config import Settings
from dataset_studio.core.errors import ResourceConflictError
from dataset_studio.modules.annotations.service import (
    AnnotationBatchRollbackError,
    AnnotationService,
    GeneratedAnnotation,
)
from dataset_studio.modules.annotations.text import AnnotationEncodingError
from dataset_studio.modules.assets.repository import AssetRepository
from dataset_studio.modules.assets.service import AssetService
from dataset_studio.modules.jobs.models import JobScope
from dataset_studio.modules.jobs.service import JobService
from dataset_studio.modules.output_resources import (
    OutputResourceClaim,
    annotation_output_resource_key,
    hold_output_resources,
)
from dataset_studio.modules.statistics.service import StatisticsService
from dataset_studio.modules.translations.service import TranslationService
from dataset_studio.modules.workspaces.paths import WorkspacePaths
from dataset_studio.modules.workspaces.repository import WorkspaceRegistry
from dataset_studio.modules.workspaces.service import WorkspaceService
from dataset_studio.platform.global_store import initialize_global_database


def _services(tmp_path: Path):
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    settings.ensure_directories()
    database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(database)
    workspaces = WorkspaceService(settings, WorkspaceRegistry(database))
    return workspaces, AssetService(workspaces), AnnotationService(workspaces)


def _write_image(path: Path, size: tuple[int, int] = (80, 120)) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, color=(225, 211, 198)).save(path)


def test_workspace_is_portable_and_scans_recursive_assets(tmp_path: Path) -> None:
    workspaces, assets, _ = _services(tmp_path)
    project = tmp_path / "Character" / "Example"
    _write_image(project / "first.png")
    _write_image(project / "nested" / "second.webp", (160, 90))
    (project / "first.json").write_text('{"artist":"test"}', encoding="utf-8")
    (project / "first.txt").write_text("<caption>ready</caption>", encoding="utf-8")

    summary, scan = workspaces.open(str(project))

    assert scan.indexed_assets == 2
    assert summary.annotated_count == 1
    listed = assets.list_assets(summary.project_id)
    assert [item.relative_path for item in listed.items] == ["first.png", "nested/second.webp"]
    assert listed.items[0].metadata_relative_path == "first.json"

    moved = tmp_path / "Style" / "MovedExample"
    moved.parent.mkdir()
    project.rename(moved)
    reopened, _ = workspaces.open(str(moved))

    assert reopened.project_id == summary.project_id
    assert reopened.root_path == str(moved.resolve())


def test_remove_recent_api_keeps_workspace_data_and_reopen_restores_entry(
    tmp_path: Path,
) -> None:
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    project = tmp_path / "dataset"
    image = project / "sample.png"
    _write_image(image)
    paths = WorkspacePaths.from_root(project.resolve(), settings)

    with TestClient(create_app(settings)) as client:
        opened = client.post("/api/v1/workspaces/open", json={"path": str(project)})
        project_id = opened.json()["workspace"]["project_id"]
        removed = client.delete(f"/api/v1/workspaces/{project_id}/recent")

        assert opened.status_code == 200
        assert removed.status_code == 204
        assert client.get("/api/v1/workspaces").json() == []
        assert client.get(f"/api/v1/workspaces/{project_id}").status_code == 200
        assert image.is_file()
        assert paths.manifest.is_file()
        assert paths.database.is_file()

        reopened = client.post("/api/v1/workspaces/open", json={"path": str(project)})
        recent = client.get("/api/v1/workspaces").json()

    assert reopened.status_code == 200
    assert reopened.json()["workspace"]["project_id"] == project_id
    assert [workspace["project_id"] for workspace in recent] == [project_id]


def test_remove_recent_clears_idle_worker_candidates(tmp_path: Path) -> None:
    workspaces, _, _ = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "sample.png")
    workspace, _ = workspaces.open(str(project))
    workspaces.mark_worker_activity(workspace.project_id, "jobs")
    workspaces.mark_worker_activity(workspace.project_id, "exports")

    workspaces.remove_recent(workspace.project_id)

    assert workspaces.list_recent() == []
    assert workspaces.worker_candidates("jobs") == []
    assert workspaces.worker_candidates("exports") == []
    assert workspaces.get(workspace.project_id)[0].database.is_file()
    assert (project / "sample.png").is_file()


def test_annotation_save_delete_and_history(tmp_path: Path) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "image.jpg")
    summary, _ = workspaces.open(str(project))
    asset = assets.list_assets(summary.project_id).items[0]

    saved = annotations.save(summary.project_id, asset.id, "<root>text</root>")
    assert saved.exists is True
    assert (project / "image.txt").read_text(encoding="utf-8") == "<root>text</root>"

    deleted = annotations.delete(summary.project_id, asset.id)
    assert deleted.exists is False
    assert not (project / "image.txt").exists()
    history = annotations.history(summary.project_id, asset.id)
    assert [revision.source for revision in history] == [
        "deleted_snapshot",
        "manual_edit",
    ]


def test_scan_preserves_annotation_written_after_scan_snapshot(
    tmp_path: Path,
    monkeypatch,
) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "image.png")
    summary, _ = workspaces.open(str(project))
    asset = assets.list_assets(summary.project_id).items[0]
    original_replace_scan = AssetRepository.replace_scan
    interleaved = False

    def replace_after_concurrent_save(repository, records, present_ids, annotation_baseline=None):
        nonlocal interleaved
        if not interleaved:
            interleaved = True
            annotations.save(summary.project_id, asset.id, "<caption>new</caption>")
        return original_replace_scan(repository, records, present_ids, annotation_baseline)

    monkeypatch.setattr(AssetRepository, "replace_scan", replace_after_concurrent_save)
    workspaces.rescan(summary.project_id)

    current = assets.list_assets(summary.project_id).items[0]
    assert current.annotation_status.value == "valid"
    assert (project / "image.txt").read_text(encoding="utf-8") == "<caption>new</caption>"


def test_invalid_utf8_annotation_is_visible_and_not_used_for_translation(tmp_path: Path) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    translations = TranslationService(workspaces)
    project = tmp_path / "dataset"
    _write_image(project / "image.png")
    (project / "image.txt").write_bytes(b"plain-text-\xff")

    summary, _ = workspaces.open(str(project))
    asset = assets.list_assets(summary.project_id).items[0]
    document = annotations.get(summary.project_id, asset.id)

    assert asset.annotation_status.value == "encoding_error"
    assert document.status.value == "encoding_error"
    assert document.validation is not None
    assert document.validation.issues[0].code == "invalid_encoding"
    translation = translations.get(summary.project_id, asset.id, "zh-CN")
    assert translation.status.value == "source_invalid"
    assert translation.issue == "源标注不是有效的 UTF-8，修复编码后才能生成译文。"
    with pytest.raises(AnnotationEncodingError, match="UTF-8"):
        translations.read_source(summary.project_id, asset.id)


def test_workspace_scan_skips_broken_images_and_reports_them(tmp_path: Path) -> None:
    workspaces, assets, _ = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "valid.png")
    (project / "broken.png").write_bytes(b"not an image")

    summary, scan = workspaces.open(str(project))

    assert summary.asset_count == 1
    assert scan.scanned_files == 2
    assert scan.indexed_assets == 1
    assert scan.failed == 1
    assert scan.issues[0].path == "broken.png"
    assert [item.filename for item in assets.list_assets(summary.project_id).items] == ["valid.png"]


def test_moved_asset_keeps_manually_accepted_annotation_status(tmp_path: Path) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "before.png")
    summary, _ = workspaces.open(str(project))
    asset = assets.list_assets(summary.project_id).items[0]
    annotations.save_generated(
        summary.project_id,
        asset.id,
        "<caption>accepted despite review</caption>",
        manually_accepted=True,
    )

    (project / "before.png").rename(project / "after.png")
    (project / "before.txt").rename(project / "after.txt")
    workspaces.rescan(summary.project_id)

    moved = assets.list_assets(summary.project_id).items[0]
    assert moved.id == asset.id
    assert moved.relative_path == "after.png"
    assert moved.annotation_status.value == "manually_accepted"


def test_annotation_save_failure_restores_exact_previous_file(
    tmp_path: Path,
    monkeypatch,
) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "image.png")
    summary, _ = workspaces.open(str(project))
    asset = assets.list_assets(summary.project_id).items[0]
    annotations.save_generated(
        summary.project_id,
        asset.id,
        "<caption>previous</caption>",
        manually_accepted=True,
    )
    annotation_path = project / "image.txt"
    previous_bytes = annotation_path.read_bytes()
    previous_modified_ns = annotation_path.stat().st_mtime_ns

    def fail_revision(*_args, **_kwargs):
        raise RuntimeError("simulated revision failure")

    monkeypatch.setattr(annotations, "_insert_revision", fail_revision)
    with pytest.raises(RuntimeError, match="simulated revision failure"):
        annotations.save(summary.project_id, asset.id, "<caption>replacement</caption>")

    assert annotation_path.read_bytes() == previous_bytes
    assert annotation_path.stat().st_mtime_ns == previous_modified_ns
    assert annotations.get(summary.project_id, asset.id).status.value == "manually_accepted"


def test_annotation_batch_failure_rolls_back_every_file_and_revision(
    tmp_path: Path,
    monkeypatch,
) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "first.png")
    _write_image(project / "second.png")
    summary, _ = workspaces.open(str(project))
    indexed = assets.list_assets(summary.project_id).items
    first = next(item for item in indexed if item.filename == "first.png")
    second = next(item for item in indexed if item.filename == "second.png")
    annotations.save_generated(
        summary.project_id,
        first.id,
        "<caption>previous</caption>",
        manually_accepted=True,
    )
    previous_bytes = (project / "first.txt").read_bytes()
    original_insert = annotations._insert_revision
    insert_count = 0

    def fail_second_revision(*args, **kwargs):
        nonlocal insert_count
        insert_count += 1
        if insert_count == 2:
            raise RuntimeError("simulated batch revision failure")
        return original_insert(*args, **kwargs)

    monkeypatch.setattr(annotations, "_insert_revision", fail_second_revision)
    with pytest.raises(RuntimeError, match="simulated batch revision failure"):
        annotations.save_generated_batch(
            summary.project_id,
            [
                GeneratedAnnotation(first.id, "<caption>replacement</caption>"),
                GeneratedAnnotation(second.id, "<caption>new</caption>"),
            ],
        )

    assert (project / "first.txt").read_bytes() == previous_bytes
    assert not (project / "second.txt").exists()
    assert len(annotations.history(summary.project_id, first.id)) == 1
    assert annotations.history(summary.project_id, second.id) == []


def test_annotation_batch_reports_incomplete_file_rollback(
    tmp_path: Path,
    monkeypatch,
) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "image.png")
    summary, _ = workspaces.open(str(project))
    asset = assets.list_assets(summary.project_id).items[0]
    annotations.save_generated(
        summary.project_id,
        asset.id,
        "<caption>previous</caption>",
    )

    def fail_revision(*_args, **_kwargs):
        raise RuntimeError("simulated database failure")

    original_replace = os.replace

    def fail_restore(source, target):
        if Path(source).suffix == ".backup" and Path(target) == project / "image.txt":
            raise OSError("simulated rollback failure")
        return original_replace(source, target)

    monkeypatch.setattr(annotations, "_insert_revision", fail_revision)
    monkeypatch.setattr(
        "dataset_studio.modules.annotations.service.os.replace",
        fail_restore,
    )

    with pytest.raises(AnnotationBatchRollbackError, match="无法回滚"):
        annotations.save_generated_batch(
            summary.project_id,
            [GeneratedAnnotation(asset.id, "<caption>replacement</caption>")],
        )


def test_annotation_delete_failure_restores_file(tmp_path: Path, monkeypatch) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "image.png")
    summary, _ = workspaces.open(str(project))
    asset = assets.list_assets(summary.project_id).items[0]
    annotations.save(summary.project_id, asset.id, "<caption>keep me</caption>")

    def fail_status_update(*_args, **_kwargs):
        raise RuntimeError("simulated status failure")

    monkeypatch.setattr(annotations, "_update_annotation_status", fail_status_update)
    with pytest.raises(RuntimeError, match="simulated status failure"):
        annotations.delete(summary.project_id, asset.id)

    assert (project / "image.txt").read_text(encoding="utf-8") == "<caption>keep me</caption>"


def test_annotation_batch_delete_is_atomic(tmp_path: Path, monkeypatch) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "first.png")
    _write_image(project / "second.png")
    (project / "first.txt").write_text("<caption>first</caption>", encoding="utf-8")
    (project / "second.txt").write_text("<caption>second</caption>", encoding="utf-8")
    summary, _ = workspaces.open(str(project))
    indexed = assets.list_assets(summary.project_id).items
    original_update = annotations._update_annotation_status
    update_count = 0

    def fail_second_update(*args, **kwargs):
        nonlocal update_count
        update_count += 1
        if update_count == 2:
            raise RuntimeError("simulated batch delete failure")
        return original_update(*args, **kwargs)

    monkeypatch.setattr(annotations, "_update_annotation_status", fail_second_update)
    with pytest.raises(RuntimeError, match="simulated batch delete failure"):
        annotations.delete_many(summary.project_id, [item.id for item in indexed])

    assert (project / "first.txt").read_text(encoding="utf-8") == "<caption>first</caption>"
    assert (project / "second.txt").read_text(encoding="utf-8") == "<caption>second</caption>"
    assert all(
        item.annotation_status.value == "valid"
        for item in assets.list_assets(summary.project_id).items
    )


def test_annotation_delete_requires_all_owners_of_shared_sidecar(tmp_path: Path) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "same.jpg")
    _write_image(project / "same.png", (90, 130))
    (project / "same.txt").write_text("<caption>shared</caption>", encoding="utf-8")
    summary, _ = workspaces.open(str(project))
    indexed = assets.list_assets(summary.project_id).items

    with pytest.raises(ValueError, match="共享同一个标注文件"):
        annotations.delete_many(summary.project_id, [indexed[0].id])

    result = annotations.delete_many(summary.project_id, [item.id for item in indexed])

    assert result.deleted_count == 2
    assert result.missing_count == 0
    assert not (project / "same.txt").exists()
    assert all(
        item.annotation_status.value == "missing"
        for item in assets.list_assets(summary.project_id).items
    )


def test_shared_sidecar_manual_save_updates_every_owner_and_blocks_generation(
    tmp_path: Path,
) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "same.jpg")
    _write_image(project / "same.png", (90, 130))
    summary, _ = workspaces.open(str(project))
    indexed = assets.list_assets(summary.project_id).items

    saved = annotations.save(
        summary.project_id,
        indexed[0].id,
        "<caption>shared</caption>",
        expected_modified_at=None,
    )

    assert saved.exists
    assert all(
        annotations.get(summary.project_id, item.id).content == "<caption>shared</caption>"
        for item in indexed
    )
    assert all(len(annotations.history(summary.project_id, item.id)) == 1 for item in indexed)
    assert StatisticsService(workspaces).tag_frequency(summary.project_id).document_count == 1
    with pytest.raises(ValueError, match="共享同一个 TXT"):
        annotations.save_generated(
            summary.project_id,
            indexed[0].id,
            "<caption>generated</caption>",
        )
    with pytest.raises(ValueError, match="共享同一个标注文件"):
        annotations.save_generated_batch(
            summary.project_id,
            [
                GeneratedAnnotation(indexed[0].id, "<caption>first</caption>"),
                GeneratedAnnotation(indexed[1].id, "<caption>second</caption>"),
            ],
        )
    paths, _ = workspaces.get(summary.project_id)
    with pytest.raises(ValueError, match="共享同一个 TXT"):
        JobService._select_annotation_assets(
            paths.database,
            JobScope.ALL,
            [],
            overwrite_existing=True,
        )


def test_missing_shared_sidecar_reconciles_every_owner_on_delete(tmp_path: Path) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "same.jpg")
    _write_image(project / "same.png", (90, 130))
    (project / "same.txt").write_text("<caption>shared</caption>", encoding="utf-8")
    summary, _ = workspaces.open(str(project))
    indexed = assets.list_assets(summary.project_id).items
    (project / "same.txt").unlink()

    result = annotations.delete_many(summary.project_id, [indexed[0].id])

    assert result.deleted_count == 0
    assert result.missing_count == 1
    assert all(
        item.annotation_status.value == "missing"
        for item in assets.list_assets(summary.project_id).items
    )


def test_annotation_save_rejects_a_stale_editor_version(tmp_path: Path) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "sample.png")
    summary, _ = workspaces.open(str(project))
    asset = assets.list_assets(summary.project_id).items[0]
    initial = annotations.save(
        summary.project_id,
        asset.id,
        "<caption>initial</caption>",
        expected_modified_at=None,
    )
    (project / "sample.txt").write_text("<caption>external</caption>", encoding="utf-8")

    with pytest.raises(ResourceConflictError, match="任务执行期间"):
        annotations.save_generated_batch(
            summary.project_id,
            [
                GeneratedAnnotation(
                    asset.id,
                    "<caption>stale model output</caption>",
                    expected_modified_at=initial.modified_at,
                )
            ],
        )
    with pytest.raises(ResourceConflictError, match="其他操作修改"):
        annotations.save(
            summary.project_id,
            asset.id,
            "<caption>stale draft</caption>",
            expected_modified_at=initial.modified_at,
        )

    assert (project / "sample.txt").read_text(encoding="utf-8") == "<caption>external</caption>"


def test_annotation_save_respects_an_active_output_resource_lease(tmp_path: Path) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "sample.png")
    summary, _ = workspaces.open(str(project))
    asset = assets.list_assets(summary.project_id).items[0]
    paths, _ = workspaces.get(summary.project_id)
    claim = OutputResourceClaim(annotation_output_resource_key("sample.txt"))

    with (
        hold_output_resources(paths.database, [claim]),
        pytest.raises(ResourceConflictError, match="写入"),
    ):
        annotations.save(
            summary.project_id,
            asset.id,
            "<caption>blocked</caption>",
            expected_modified_at=None,
        )

    saved = annotations.save(
        summary.project_id,
        asset.id,
        "<caption>after lease</caption>",
        expected_modified_at=None,
    )
    assert saved.content == "<caption>after lease</caption>"


def test_annotation_read_rejects_a_sidecar_replaced_by_a_symbolic_link(
    tmp_path: Path,
) -> None:
    workspaces, assets, annotations = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "sample.png")
    summary, _ = workspaces.open(str(project))
    asset = assets.list_assets(summary.project_id).items[0]
    annotations.save(summary.project_id, asset.id, "<caption>inside</caption>")
    annotation_path = project / "sample.txt"
    annotation_path.unlink()
    external = tmp_path / "external.txt"
    external.write_text("<caption>outside</caption>", encoding="utf-8")
    try:
        annotation_path.symlink_to(external)
    except OSError as error:
        pytest.skip(f"当前环境不能创建符号链接：{error}")

    with pytest.raises(ValueError, match="符号链接"):
        annotations.get(summary.project_id, asset.id)

    assert StatisticsService(workspaces).tag_frequency(summary.project_id).document_count == 0


def test_asset_folder_tree_and_filter_use_subtree_boundaries(tmp_path: Path) -> None:
    workspaces, assets, _ = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "root.png")
    _write_image(project / "foo" / "direct.png")
    _write_image(project / "foo" / "nested" / "deep.png")
    _write_image(project / "foobar" / "other.png")
    summary, _ = workspaces.open(str(project))

    folders = {item.path: item for item in assets.list_folders(summary.project_id).items}
    assert folders[""].direct_asset_count == 1
    assert folders[""].descendant_asset_count == 4
    assert folders["foo"].direct_asset_count == 1
    assert folders["foo"].descendant_asset_count == 2
    assert folders["foo/nested"].parent_path == "foo"
    assert folders["foobar"].descendant_asset_count == 1

    in_foo = assets.list_assets(summary.project_id, folder_path="foo")
    assert [item.relative_path for item in in_foo.items] == [
        "foo/direct.png",
        "foo/nested/deep.png",
    ]
    assert in_foo.status_counts["all"] == 2
    assert in_foo.status_counts["missing"] == 2
    assert assets.list_asset_ids(summary.project_id, folder_path="foo").total == 2
    with pytest.raises(ValueError, match="当前工作区"):
        assets.list_assets(summary.project_id, folder_path="../outside")


def test_new_duplicate_does_not_steal_existing_asset_identity(tmp_path: Path) -> None:
    workspaces, assets, _ = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "z.png")
    summary, _ = workspaces.open(str(project))
    original = assets.list_assets(summary.project_id).items[0]
    (project / "a.png").write_bytes((project / "z.png").read_bytes())

    workspaces.rescan(summary.project_id)

    listed = assets.list_assets(summary.project_id).items
    assert [item.relative_path for item in listed] == ["a.png", "z.png"]
    assert len({item.id for item in listed}) == 2
    assert next(item for item in listed if item.relative_path == "z.png").id == original.id


def test_case_only_rename_preserves_asset_identity(tmp_path: Path) -> None:
    workspaces, assets, _ = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "Before.png")
    summary, _ = workspaces.open(str(project))
    original = assets.list_assets(summary.project_id).items[0]
    intermediate = project / "temporary-name.png"
    (project / "Before.png").rename(intermediate)
    intermediate.rename(project / "before.png")

    workspaces.rescan(summary.project_id)

    renamed = assets.list_assets(summary.project_id).items[0]
    assert renamed.relative_path == "before.png"
    assert renamed.id == original.id


def test_case_distinct_files_remain_distinct_when_filesystem_supports_them(
    tmp_path: Path,
) -> None:
    workspaces, assets, _ = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "Case.png")
    summary, _ = workspaces.open(str(project))
    _write_image(project / "case.png", (90, 130))
    if len(list(project.glob("*.png"))) < 2:
        pytest.skip("filesystem is case-insensitive")

    workspaces.rescan(summary.project_id)

    listed = assets.list_assets(summary.project_id).items
    assert {item.relative_path for item in listed} == {"Case.png", "case.png"}
    assert len({item.id for item in listed}) == 2


def test_thumbnail_cache_key_changes_with_image_content(tmp_path: Path) -> None:
    workspaces, assets, _ = _services(tmp_path)
    project = tmp_path / "dataset"
    image_path = project / "image.png"
    _write_image(image_path)
    summary, _ = workspaces.open(str(project))
    asset = assets.list_assets(summary.project_id).items[0]
    first_thumbnail = assets.thumbnail_path(summary.project_id, asset.id, 96)

    Image.new("RGB", (80, 120), "black").save(image_path)
    workspaces.rescan(summary.project_id)
    changed_asset = assets.list_assets(summary.project_id).items[0]
    second_thumbnail = assets.thumbnail_path(summary.project_id, asset.id, 96)

    assert changed_asset.content_version != asset.content_version
    assert first_thumbnail != second_thumbnail
    assert first_thumbnail.is_file()
    assert second_thumbnail.is_file()
