from __future__ import annotations

import json
import zipfile
from pathlib import Path
from types import SimpleNamespace
from typing import cast

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from dataset_studio.api.app import create_app
from dataset_studio.api.container import AppContainer
from dataset_studio.core.config import Settings
from dataset_studio.core.sqlite import connect
from dataset_studio.modules.annotations.models import AnnotationChannel, AnnotationTag
from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.assets.service import AssetService
from dataset_studio.modules.exports.models import (
    ExportChannelSelection,
    ExportCreateRequest,
    ExportDirectoryLayout,
    ExportDirectoryMode,
    ExportFormat,
    ExportOperationStatus,
    ExportPackaging,
    ExportRequest,
    ExportRevisionMode,
    ExportScope,
)
from dataset_studio.modules.exports.repository import ExportRepository
from dataset_studio.modules.exports.service import ExportService
from dataset_studio.modules.exports.worker import ExportWorker
from dataset_studio.modules.translations.service import TranslationService
from dataset_studio.modules.workspaces.repository import WorkspaceRegistry
from dataset_studio.modules.workspaces.service import WorkspaceService
from dataset_studio.platform.global_store import initialize_global_database


def _services(tmp_path: Path):
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    settings.ensure_directories()
    global_database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(global_database)
    workspaces = WorkspaceService(settings, WorkspaceRegistry(global_database))
    return (
        workspaces,
        AssetService(workspaces),
        AnnotationService(workspaces),
        ExportService(workspaces),
    )


def _write_image(path: Path, color: str = "white") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (48, 32), color).save(path)


def _run_export(workspaces: WorkspaceService, project_id: str, operation_id: str) -> None:
    paths, _ = workspaces.get(project_id)
    repository = ExportRepository(paths.database)
    claimed = repository.claim_next_operation()
    assert claimed is not None
    assert claimed.id == operation_id
    container = cast(AppContainer, SimpleNamespace(workspaces=workspaces))
    ExportWorker(container)._process_operation(project_id, operation_id)


def test_idle_export_worker_does_not_scan_recent_workspaces(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspaces, _, _, _ = _services(tmp_path)
    project = tmp_path / "idle-dataset"
    project.mkdir()
    workspaces.open(str(project))

    def fail_recent_scan():
        raise AssertionError("idle export worker must not enumerate recent workspaces")

    monkeypatch.setattr(workspaces, "list_recent", fail_recent_scan)
    container = cast(AppContainer, SimpleNamespace(workspaces=workspaces))

    assert ExportWorker(container)._claim_next() is None


def test_export_directory_layout_validates_safe_custom_paths() -> None:
    layout = ExportDirectoryLayout(
        mode=ExportDirectoryMode.CUSTOM,
        merge_into_parent_paths=[" characters/alice ", "characters/ALICE"],
    )
    assert layout.merge_into_parent_paths == ["characters/alice"]

    with pytest.raises(ValueError, match="安全相对路径"):
        ExportDirectoryLayout(
            mode=ExportDirectoryMode.CUSTOM,
            merge_into_parent_paths=["characters/../outside"],
        )
    with pytest.raises(ValueError, match="只有自定义目录模式"):
        ExportDirectoryLayout(
            mode=ExportDirectoryMode.PRESERVE,
            merge_into_parent_paths=["characters"],
        )


def test_export_materializes_multiple_database_channels_as_variants_and_json(
    tmp_path: Path,
) -> None:
    workspaces, assets, annotations, exports = _services(tmp_path)
    project = tmp_path / "数据集"
    _write_image(project / "a" / "first.png", "red")
    _write_image(project / "b" / "second.webp", "green")
    workspace, _ = workspaces.open(str(project))
    by_name = {asset.filename: asset for asset in assets.list_assets(workspace.project_id).items}
    for asset in by_name.values():
        annotations.save_tags(
            workspace.project_id,
            asset.id,
            [
                AnnotationTag(name="character", category="general", origin="manual"),
                AnnotationTag(name=asset.filename.split(".")[0], origin="manual"),
            ],
        )
        annotations.save_text(
            workspace.project_id,
            asset.id,
            AnnotationChannel.DESCRIPTION,
            f"<caption>{asset.filename}</caption>",
        )

    destination = tmp_path / "export"
    destination.mkdir()
    request = ExportRequest(
        destination_path=str(destination),
        channels=[
            ExportChannelSelection(channel=AnnotationChannel.TAGS),
            ExportChannelSelection(channel=AnnotationChannel.DESCRIPTION),
        ],
        formats=[ExportFormat.TXT, ExportFormat.JSON],
        directory_layout=ExportDirectoryLayout(mode=ExportDirectoryMode.PRESERVE),
    )
    preview = exports.preview(workspace.project_id, request)

    assert preview.total_items == 2
    assert preview.usable_count == 2
    assert preview.reviewed_count == 0
    assert preview.unreviewed_count == 2
    assert preview.warning_count == 0
    assert set(preview.items[0].channel_statuses.values()) == {"usable"}
    assert any(target.startswith("tags/数据集/") for target in preview.items[0].target_outputs)
    assert any(
        target.startswith("description/数据集/") for target in preview.items[0].target_outputs
    )
    assert any(target.startswith("metadata/数据集/") for target in preview.items[0].target_outputs)

    operation = exports.create(
        workspace.project_id,
        ExportCreateRequest(request=request, preview_token=preview.preview_token),
    )
    _run_export(workspaces, workspace.project_id, operation.id)

    completed = exports.get(workspace.project_id, operation.id)
    assert completed.status == ExportOperationStatus.COMPLETED
    assert completed.configuration_snapshot["formats"] == ["txt", "json"]
    assert (destination / "tags" / "数据集" / "a" / "first.png").read_bytes() == (
        project / "a" / "first.png"
    ).read_bytes()
    assert (destination / "tags" / "数据集" / "a" / "first.txt").read_text(
        encoding="utf-8"
    ) == "character, first"
    assert (destination / "description" / "数据集" / "a" / "first.txt").read_text(
        encoding="utf-8"
    ) == "<caption>first.png</caption>"
    metadata = json.loads(
        (destination / "metadata" / "数据集" / "a" / "first.annotations.json").read_text(
            encoding="utf-8"
        )
    )
    assert [tag["name"] for tag in metadata["annotations"]["tags"]["tags"]] == [
        "character",
        "first",
    ]
    assert metadata["annotations"]["description"]["content"] == "<caption>first.png</caption>"


def test_export_preserves_workspace_directories_for_directory_and_zip_outputs(
    tmp_path: Path,
) -> None:
    workspaces, _, _, exports = _services(tmp_path)
    project = tmp_path / "preserved-dataset"
    _write_image(project / "characters" / "alice" / "image.png")
    (project / "characters" / "alice" / "image.txt").write_text("ready", encoding="utf-8")
    workspace, _ = workspaces.open(str(project))
    layout = ExportDirectoryLayout(mode=ExportDirectoryMode.PRESERVE)

    directory_destination = tmp_path / "preserved-directory"
    directory_destination.mkdir()
    directory_request = ExportRequest(
        destination_path=str(directory_destination),
        directory_layout=layout,
    )
    directory_preview = exports.preview(workspace.project_id, directory_request)
    assert set(directory_preview.items[0].target_outputs) == {
        "preserved-dataset/characters/alice/image.png",
        "preserved-dataset/characters/alice/image.txt",
    }
    directory_operation = exports.create(
        workspace.project_id,
        ExportCreateRequest(
            request=directory_request,
            preview_token=directory_preview.preview_token,
        ),
    )
    _run_export(workspaces, workspace.project_id, directory_operation.id)
    assert (
        directory_destination / "preserved-dataset" / "characters" / "alice" / "image.png"
    ).is_file()
    assert (
        directory_destination / "preserved-dataset" / "characters" / "alice" / "image.txt"
    ).read_text(encoding="utf-8") == "ready"

    zip_destination = tmp_path / "preserved-zip"
    zip_destination.mkdir()
    zip_request = ExportRequest(
        destination_path=str(zip_destination),
        directory_layout=layout,
        packaging=ExportPackaging.ZIP,
    )
    zip_preview = exports.preview(workspace.project_id, zip_request)
    zip_operation = exports.create(
        workspace.project_id,
        ExportCreateRequest(request=zip_request, preview_token=zip_preview.preview_token),
    )
    _run_export(workspaces, workspace.project_id, zip_operation.id)
    with zipfile.ZipFile(zip_destination / "preserved-zip.zip") as archive:
        assert set(archive.namelist()) == {
            "preserved-dataset/characters/alice/image.png",
            "preserved-dataset/characters/alice/image.txt",
        }


def test_export_custom_layout_removes_only_selected_original_directory_levels(
    tmp_path: Path,
) -> None:
    workspaces, _, _, exports = _services(tmp_path)
    project = tmp_path / "custom-layout"
    image = project / "characters" / "alice" / "set-1" / "image.png"
    _write_image(image)
    image.with_suffix(".txt").write_text("ready", encoding="utf-8")
    workspace, _ = workspaces.open(str(project))
    destination = tmp_path / "custom-layout-export"
    destination.mkdir()
    request = ExportRequest(
        destination_path=str(destination),
        directory_layout=ExportDirectoryLayout(
            mode=ExportDirectoryMode.CUSTOM,
            merge_into_parent_paths=["characters", "characters/alice"],
        ),
    )

    preview = exports.preview(workspace.project_id, request)

    assert set(preview.items[0].target_outputs) == {
        "custom-layout/set-1/image.png",
        "custom-layout/set-1/image.txt",
    }
    operation = exports.create(
        workspace.project_id,
        ExportCreateRequest(request=request, preview_token=preview.preview_token),
    )
    assert operation.configuration_snapshot["directory_layout"] == {
        "mode": "custom",
        "merge_into_parent_paths": ["characters", "characters/alice"],
    }
    _run_export(workspaces, workspace.project_id, operation.id)
    assert (destination / "custom-layout" / "set-1" / "image.png").is_file()
    assert (destination / "custom-layout" / "set-1" / "image.txt").is_file()


def test_export_custom_layout_blocks_file_and_directory_mapping_collisions(
    tmp_path: Path,
) -> None:
    workspaces, _, _, exports = _services(tmp_path)
    project = tmp_path / "custom-layout-collision"
    _write_image(project / "file-source" / "foo.png")
    _write_image(project / "folder-source" / "foo.png" / "nested.jpg")
    workspace, _ = workspaces.open(str(project))
    destination = tmp_path / "custom-layout-collision-export"
    destination.mkdir()
    request = ExportRequest(
        destination_path=str(destination),
        formats=[ExportFormat.JSON],
        directory_layout=ExportDirectoryLayout(
            mode=ExportDirectoryMode.CUSTOM,
            merge_into_parent_paths=["file-source", "folder-source"],
        ),
    )

    preview = exports.preview(workspace.project_id, request)

    assert preview.blocking_issue_count == 2
    assert all(
        item.blocking_issue and "目标文件与目录发生冲突" in item.blocking_issue
        for item in preview.items
    )


def test_export_streams_frozen_artifacts_into_a_zip_archive(tmp_path: Path) -> None:
    workspaces, _, _, exports = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "image.png")
    (project / "image.txt").write_text("ready", encoding="utf-8")
    workspace, _ = workspaces.open(str(project))
    destination = tmp_path / "zip-export"
    destination.mkdir()
    request = ExportRequest(
        destination_path=str(destination),
        packaging=ExportPackaging.ZIP,
    )
    preview = exports.preview(workspace.project_id, request)
    operation = exports.create(
        workspace.project_id,
        ExportCreateRequest(request=request, preview_token=preview.preview_token),
    )

    _run_export(workspaces, workspace.project_id, operation.id)

    completed = exports.get(workspace.project_id, operation.id)
    archive_path = destination / "zip-export.zip"
    assert completed.status == ExportOperationStatus.COMPLETED
    assert completed.configuration_snapshot["packaging"] == "zip"
    assert list(destination.iterdir()) == [archive_path]
    with zipfile.ZipFile(archive_path) as archive:
        assert archive.comment == f"dataset-studio-export:{operation.id}".encode()
        assert set(archive.namelist()) == {"image.png", "image.txt"}
        assert archive.read("image.png") == (project / "image.png").read_bytes()
        assert archive.read("image.txt") == b"ready"
        assert archive.getinfo("image.png").compress_type == zipfile.ZIP_STORED
        assert archive.getinfo("image.txt").compress_type == zipfile.ZIP_DEFLATED
        assert archive.testzip() is None


def test_zip_export_preserves_multi_channel_layout(tmp_path: Path) -> None:
    workspaces, assets, annotations, exports = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "image.png")
    workspace, _ = workspaces.open(str(project))
    asset = assets.list_assets(workspace.project_id).items[0]
    annotations.save_tags(
        workspace.project_id,
        asset.id,
        [AnnotationTag(name="character", origin="manual")],
    )
    annotations.save_text(
        workspace.project_id,
        asset.id,
        AnnotationChannel.DESCRIPTION,
        "<caption>ready</caption>",
    )
    destination = tmp_path / "multi-channel-zip"
    destination.mkdir()
    existing_directory = destination / "tags"
    existing_directory.mkdir()
    marker = existing_directory / "keep.me"
    marker.write_text("user-owned", encoding="utf-8")
    request = ExportRequest(
        destination_path=str(destination),
        channels=[
            ExportChannelSelection(channel=AnnotationChannel.TAGS),
            ExportChannelSelection(channel=AnnotationChannel.DESCRIPTION),
        ],
        formats=[ExportFormat.TXT, ExportFormat.JSON],
        packaging=ExportPackaging.ZIP,
    )
    preview = exports.preview(workspace.project_id, request)
    operation = exports.create(
        workspace.project_id,
        ExportCreateRequest(request=request, preview_token=preview.preview_token),
    )

    _run_export(workspaces, workspace.project_id, operation.id)

    assert marker.read_text(encoding="utf-8") == "user-owned"
    with zipfile.ZipFile(destination / "multi-channel-zip.zip") as archive:
        assert set(archive.namelist()) == {
            "description/image.png",
            "description/image.txt",
            "metadata/image.annotations.json",
            "tags/image.png",
            "tags/image.txt",
        }
        assert archive.read("tags/image.txt") == b"character"
        assert archive.read("description/image.txt") == b"<caption>ready</caption>"
        metadata = json.loads(archive.read("metadata/image.annotations.json"))
        assert metadata["annotations"]["tags"]["tags"][0]["name"] == "character"


def test_zip_export_allows_a_nonempty_destination_without_touching_existing_entries(
    tmp_path: Path,
) -> None:
    workspaces, _, _, exports = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "image.png")
    (project / "image.txt").write_text("ready", encoding="utf-8")
    workspace, _ = workspaces.open(str(project))
    destination = tmp_path / "shared-export-folder"
    destination.mkdir()
    preserved_file = destination / "keep.me"
    preserved_file.write_text("user-owned", encoding="utf-8")
    preserved_directory = destination / "existing-directory"
    preserved_directory.mkdir()
    request = ExportRequest(
        destination_path=str(destination),
        packaging=ExportPackaging.ZIP,
    )

    preview = exports.preview(workspace.project_id, request)
    assert preview.blocking_issue_count == 0
    operation = exports.create(
        workspace.project_id,
        ExportCreateRequest(request=request, preview_token=preview.preview_token),
    )
    late_file = destination / "created-after-preview.me"
    late_file.write_text("late-user-owned", encoding="utf-8")
    top_level_prefix_match = destination / f".dataset-studio-export-{operation.id}-user-owned.txt"
    top_level_prefix_match.write_text("top-level-user-owned", encoding="utf-8")
    nested_prefix_match = preserved_directory / f".dataset-studio-export-{operation.id}-user-owned"
    nested_prefix_match.write_text("nested-user-owned", encoding="utf-8")
    _run_export(workspaces, workspace.project_id, operation.id)

    archive_path = destination / "shared-export-folder.zip"
    assert exports.get(workspace.project_id, operation.id).status == ExportOperationStatus.COMPLETED
    assert preserved_file.read_text(encoding="utf-8") == "user-owned"
    assert preserved_directory.is_dir()
    assert late_file.read_text(encoding="utf-8") == "late-user-owned"
    assert top_level_prefix_match.read_text(encoding="utf-8") == "top-level-user-owned"
    assert nested_prefix_match.read_text(encoding="utf-8") == "nested-user-owned"
    assert archive_path.is_file()

    conflict_preview = exports.preview(workspace.project_id, request)
    assert conflict_preview.blocking_issues == ["目标 ZIP 压缩包已经存在，无法覆盖。"]


def test_zip_export_preserves_an_unowned_staging_directory(tmp_path: Path) -> None:
    workspaces, _, _, exports = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "image.png")
    (project / "image.txt").write_text("ready", encoding="utf-8")
    workspace, _ = workspaces.open(str(project))
    destination = tmp_path / "unowned-staging"
    destination.mkdir()
    request = ExportRequest(
        destination_path=str(destination),
        packaging=ExportPackaging.ZIP,
    )
    preview = exports.preview(workspace.project_id, request)
    operation = exports.create(
        workspace.project_id,
        ExportCreateRequest(request=request, preview_token=preview.preview_token),
    )
    staging = destination / f".dataset-studio-export-{operation.id}"
    staging.mkdir()
    marker = staging / "keep.me"
    marker.write_text("user-owned", encoding="utf-8")

    _run_export(workspaces, workspace.project_id, operation.id)

    failed = exports.get(workspace.project_id, operation.id)
    assert failed.status == ExportOperationStatus.FAILED
    assert "无法验证所有权" in (failed.error_message or "")
    assert marker.read_text(encoding="utf-8") == "user-owned"


def test_stopped_zip_export_discards_partial_archive_and_restarts(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspaces, _, _, exports = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "first.png")
    _write_image(project / "second.png", "black")
    (project / "first.txt").write_text("first", encoding="utf-8")
    (project / "second.txt").write_text("second", encoding="utf-8")
    workspace, _ = workspaces.open(str(project))
    destination = tmp_path / "zip-resume"
    destination.mkdir()
    request = ExportRequest(
        destination_path=str(destination),
        packaging=ExportPackaging.ZIP,
    )
    preview = exports.preview(workspace.project_id, request)
    operation = exports.create(
        workspace.project_id,
        ExportCreateRequest(request=request, preview_token=preview.preview_token),
    )
    paths, _ = workspaces.get(workspace.project_id)
    repository = ExportRepository(paths.database)
    assert repository.claim_next_operation() is not None
    container = cast(AppContainer, SimpleNamespace(workspaces=workspaces))
    worker = ExportWorker(container)
    write_image = worker._write_image_to_archive
    stop_requested = False

    def write_then_stop(*args, **kwargs):
        nonlocal stop_requested
        result = write_image(*args, **kwargs)
        if not stop_requested:
            stop_requested = True
            assert repository.request_stop(operation.id)
        return result

    monkeypatch.setattr(worker, "_write_image_to_archive", write_then_stop)
    worker._process_operation(workspace.project_id, operation.id)

    stopped = exports.get(workspace.project_id, operation.id)
    assert stopped.status == ExportOperationStatus.STOPPED
    assert stopped.completed_items == 0
    assert stopped.copied_bytes == 0
    assert list(destination.iterdir()) == []

    monkeypatch.setattr(worker, "_write_image_to_archive", write_image)
    resumed = exports.resume(workspace.project_id, operation.id)
    assert resumed.status == ExportOperationStatus.QUEUED
    _run_export(workspaces, workspace.project_id, operation.id)
    assert exports.get(workspace.project_id, operation.id).status == ExportOperationStatus.COMPLETED
    assert [entry.name for entry in destination.iterdir()] == ["zip-resume.zip"]


def test_orphaned_zip_export_discards_owned_archive_and_resets_all_progress(
    tmp_path: Path,
) -> None:
    workspaces, _, _, exports = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "first.png")
    _write_image(project / "second.png", "black")
    (project / "first.txt").write_text("first", encoding="utf-8")
    (project / "second.txt").write_text("second", encoding="utf-8")
    workspace, _ = workspaces.open(str(project))
    destination = tmp_path / "zip-recovery"
    destination.mkdir()
    request = ExportRequest(
        destination_path=str(destination),
        packaging=ExportPackaging.ZIP,
    )
    preview = exports.preview(workspace.project_id, request)
    operation = exports.create(
        workspace.project_id,
        ExportCreateRequest(request=request, preview_token=preview.preview_token),
    )
    paths, _ = workspaces.get(workspace.project_id)
    repository = ExportRepository(paths.database)
    assert repository.claim_next_operation() is not None
    while item := repository.claim_next_item(operation.id):
        artifacts = json.loads(str(item["artifact_snapshot"]))
        repository.complete_item(
            operation.id,
            str(item["id"]),
            sum(int(artifact["byte_size"]) for artifact in artifacts),
        )

    staging = destination / f".dataset-studio-export-{operation.id}"
    staging.mkdir()
    (staging / ".owner").write_text(operation.id, encoding="ascii")
    partial = staging / "archive.zip"
    partial.write_bytes(b"partial")
    archive_path = destination / "zip-recovery.zip"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.comment = f"dataset-studio-export:{operation.id}".encode()
        archive.writestr("first.txt", b"first")

    container = cast(AppContainer, SimpleNamespace(workspaces=workspaces))
    ExportWorker(container)._recover_orphaned()

    interrupted = exports.get(workspace.project_id, operation.id)
    assert interrupted.status == ExportOperationStatus.INTERRUPTED
    assert interrupted.completed_items == 0
    assert interrupted.copied_bytes == 0
    assert {str(item["status"]) for item in repository.operation_items(operation.id)} == {"pending"}
    assert list(destination.iterdir()) == []

    assert exports.resume(workspace.project_id, operation.id).status == ExportOperationStatus.QUEUED
    _run_export(workspaces, workspace.project_id, operation.id)
    assert exports.get(workspace.project_id, operation.id).status == ExportOperationStatus.COMPLETED
    assert [entry.name for entry in destination.iterdir()] == ["zip-recovery.zip"]


def test_zip_export_never_removes_an_external_archive_created_after_preview(
    tmp_path: Path,
) -> None:
    workspaces, _, _, exports = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "image.png")
    (project / "image.txt").write_text("ready", encoding="utf-8")
    workspace, _ = workspaces.open(str(project))
    destination = tmp_path / "external-archive"
    destination.mkdir()
    request = ExportRequest(
        destination_path=str(destination),
        packaging=ExportPackaging.ZIP,
    )
    preview = exports.preview(workspace.project_id, request)
    operation = exports.create(
        workspace.project_id,
        ExportCreateRequest(request=request, preview_token=preview.preview_token),
    )
    archive_path = destination / "external-archive.zip"
    archive_path.write_bytes(b"user-owned")

    _run_export(workspaces, workspace.project_id, operation.id)

    failed = exports.get(workspace.project_id, operation.id)
    assert failed.status == ExportOperationStatus.FAILED
    assert "目标 ZIP 压缩包已经存在" in (failed.error_message or "")
    assert archive_path.read_bytes() == b"user-owned"


def test_zip_publication_never_replaces_an_existing_target(tmp_path: Path) -> None:
    temporary = tmp_path / "temporary.zip"
    target = tmp_path / "target.zip"
    temporary.write_bytes(b"new archive")
    target.write_bytes(b"user-owned")

    with pytest.raises(ValueError, match="目标 ZIP 压缩包已经存在"):
        ExportWorker._publish_archive(temporary, target)

    assert temporary.read_bytes() == b"new archive"
    assert target.read_bytes() == b"user-owned"


def test_export_worker_fails_an_invalid_packaging_snapshot_without_escaping(
    tmp_path: Path,
) -> None:
    workspaces, _, _, exports = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "image.png")
    workspace, _ = workspaces.open(str(project))
    destination = tmp_path / "invalid-packaging"
    destination.mkdir()
    request = ExportRequest(destination_path=str(destination))
    preview = exports.preview(workspace.project_id, request)
    operation = exports.create(
        workspace.project_id,
        ExportCreateRequest(
            request=request,
            preview_token=preview.preview_token,
            allow_warnings=True,
        ),
    )
    paths, _ = workspaces.get(workspace.project_id)
    with connect(paths.database) as connection:
        connection.execute(
            "UPDATE export_operations SET configuration_snapshot = ? WHERE id = ?",
            ('{"packaging":"tar"}', operation.id),
        )
        connection.commit()

    _run_export(workspaces, workspace.project_id, operation.id)

    failed = exports.get(workspace.project_id, operation.id)
    assert failed.status == ExportOperationStatus.FAILED
    assert failed.error_message == "导出任务的输出方式快照无效。"
    assert list(destination.iterdir()) == []


def test_export_warns_when_translation_depends_on_an_old_source_revision(
    tmp_path: Path,
) -> None:
    workspaces, assets, annotations, exports = _services(tmp_path)
    translations = TranslationService(workspaces, annotations)
    project = tmp_path / "dataset"
    _write_image(project / "image.png")
    workspace, _ = workspaces.open(str(project))
    asset = assets.list_assets(workspace.project_id).items[0]
    source = annotations.save_text(
        workspace.project_id,
        asset.id,
        AnnotationChannel.DESCRIPTION,
        "<caption>source one</caption>",
    )
    source_revision = translations.read_source_revision(workspace.project_id, asset.id)
    assert source_revision is not None
    translations.save_generated(
        workspace.project_id,
        asset.id,
        "zh-CN",
        "<caption>译文一</caption>",
        expected_source_hash=source_revision[2],
    )
    annotations.save_text(
        workspace.project_id,
        asset.id,
        AnnotationChannel.DESCRIPTION,
        "<caption>source two</caption>",
        expected_head_revision_id=source.revision_id,
    )
    destination = tmp_path / "export"
    destination.mkdir()

    preview = exports.preview(
        workspace.project_id,
        ExportRequest(
            destination_path=str(destination),
            channels=[
                ExportChannelSelection(
                    channel=AnnotationChannel.TRANSLATION,
                    language="zh-CN",
                )
            ],
        ),
    )

    assert preview.stale_count == 1
    assert preview.warning_count == 1
    assert preview.items[0].annotation_status == "stale"
    assert preview.items[0].channel_statuses == {"translation:description:llm:zh-CN": "stale"}
    assert "源标注变化" in (preview.items[0].warning_message or "")


def test_force_export_preserves_invalid_legacy_bytes_from_frozen_revision(
    tmp_path: Path,
) -> None:
    workspaces, _, _, exports = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "image.png")
    encoded_bytes = b"\xff\xfelegacy"
    (project / "image.txt").write_bytes(encoded_bytes)
    workspace, _ = workspaces.open(str(project))
    destination = tmp_path / "raw-export"
    destination.mkdir()
    request = ExportRequest(destination_path=str(destination))
    preview = exports.preview(workspace.project_id, request)

    assert preview.total_items == 1
    assert preview.encoding_error_count == 1
    assert preview.warning_count == 1
    with pytest.raises(ValueError, match="标注警告"):
        exports.create(
            workspace.project_id,
            ExportCreateRequest(request=request, preview_token=preview.preview_token),
        )

    operation = exports.create(
        workspace.project_id,
        ExportCreateRequest(
            request=request,
            preview_token=preview.preview_token,
            allow_warnings=True,
        ),
    )
    _run_export(workspaces, workspace.project_id, operation.id)
    assert (destination / "image.txt").read_bytes() == encoded_bytes
    assert (project / "image.txt").read_bytes() == encoded_bytes


def test_export_preview_blocks_nonempty_destination_and_flat_name_collisions(
    tmp_path: Path,
) -> None:
    workspaces, _, _, exports = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "same.jpg")
    _write_image(project / "same.png", "black")
    (project / "same.txt").write_text("<caption>shared</caption>", encoding="utf-8")
    workspace, _ = workspaces.open(str(project))
    destination = tmp_path / "collision-export"
    destination.mkdir()

    collision_preview = exports.preview(
        workspace.project_id,
        ExportRequest(destination_path=str(destination)),
    )
    assert collision_preview.blocking_issue_count == 2
    assert all(
        item.blocking_issue and "同一个目标文件" in item.blocking_issue
        for item in collision_preview.items
    )
    with pytest.raises(ValueError, match="同一个目标文件"):
        exports.create(
            workspace.project_id,
            ExportCreateRequest(
                request=ExportRequest(destination_path=str(destination)),
                preview_token=collision_preview.preview_token,
                allow_warnings=True,
            ),
        )

    (destination / "keep.me").write_text("occupied", encoding="utf-8")
    occupied_preview = exports.preview(
        workspace.project_id,
        ExportRequest(destination_path=str(destination)),
    )
    assert "导出目录必须为空" in occupied_preview.blocking_issues[0]

    inside_workspace = project / "export"
    inside_workspace.mkdir()
    inside_preview = exports.preview(
        workspace.project_id,
        ExportRequest(destination_path=str(inside_workspace)),
    )
    assert "导出目录不能位于当前项目内部" in inside_preview.blocking_issues[0]


def test_export_preview_is_invalidated_by_a_new_revision_even_with_same_content(
    tmp_path: Path,
) -> None:
    workspaces, assets, annotations, exports = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "first.png")
    _write_image(project / "second.png")
    workspace, _ = workspaces.open(str(project))
    listed = assets.list_assets(workspace.project_id).items
    selected = next(item for item in listed if item.filename == "second.png")
    first = annotations.save_text(
        workspace.project_id,
        selected.id,
        AnnotationChannel.DESCRIPTION,
        "same content",
    )
    destination = tmp_path / "selected-export"
    destination.mkdir()
    request = ExportRequest(
        scope=ExportScope.SELECTED,
        asset_ids=[selected.id],
        destination_path=str(destination),
        channels=[
            ExportChannelSelection(
                channel=AnnotationChannel.DESCRIPTION,
                revision=ExportRevisionMode.CURRENT,
            )
        ],
    )
    preview = exports.preview(workspace.project_id, request)
    assert preview.total_items == 1

    annotations.save_text(
        workspace.project_id,
        selected.id,
        AnnotationChannel.DESCRIPTION,
        "same content",
        expected_head_revision_id=first.revision_id,
    )
    with pytest.raises(ValueError, match="预览已失效"):
        exports.create(
            workspace.project_id,
            ExportCreateRequest(
                request=request,
                preview_token=preview.preview_token,
            ),
        )


def test_stopped_export_can_resume_from_project_database(tmp_path: Path) -> None:
    workspaces, _, _, exports = _services(tmp_path)
    project = tmp_path / "dataset"
    _write_image(project / "image.png")
    (project / "image.txt").write_text("ready", encoding="utf-8")
    workspace, _ = workspaces.open(str(project))
    destination = tmp_path / "resume-export"
    destination.mkdir()
    request = ExportRequest(destination_path=str(destination))
    preview = exports.preview(workspace.project_id, request)
    operation = exports.create(
        workspace.project_id,
        ExportCreateRequest(request=request, preview_token=preview.preview_token),
    )
    paths, _ = workspaces.get(workspace.project_id)
    repository = ExportRepository(paths.database)
    assert repository.claim_next_operation() is not None
    assert repository.request_stop(operation.id)

    container = cast(AppContainer, SimpleNamespace(workspaces=workspaces))
    worker = ExportWorker(container)
    worker._process_operation(workspace.project_id, operation.id)
    assert exports.get(workspace.project_id, operation.id).status == ExportOperationStatus.STOPPED
    assert list(destination.iterdir()) == []

    resumed = exports.resume(workspace.project_id, operation.id)
    assert resumed.status == ExportOperationStatus.QUEUED
    _run_export(workspaces, workspace.project_id, operation.id)
    assert exports.get(workspace.project_id, operation.id).status == ExportOperationStatus.COMPLETED
    assert {entry.name for entry in destination.iterdir()} == {"image.png", "image.txt"}


def test_export_api_uses_persistent_active_state_and_blocks_annotation_edits(
    tmp_path: Path,
) -> None:
    project = tmp_path / "dataset"
    _write_image(project / "image.png")
    (project / "image.txt").write_text("ready", encoding="utf-8")
    destination = tmp_path / "api-export"
    destination.mkdir()
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)

    with TestClient(create_app(settings)) as client:
        opened = client.post("/api/v1/workspaces/open", json={"path": str(project)})
        project_id = opened.json()["workspace"]["project_id"]
        asset_id = client.get(f"/api/v1/workspaces/{project_id}/assets").json()["items"][0]["id"]
        request = {
            "scope": "all",
            "asset_ids": [],
            "destination_path": str(destination),
            "channels": [
                {
                    "channel": "existing_annotation",
                    "language": "",
                    "revision": "current",
                }
            ],
            "formats": ["txt"],
        }
        preview = client.post(
            f"/api/v1/workspaces/{project_id}/exports/preview",
            json=request,
        )
        assert preview.status_code == 200
        created = client.post(
            f"/api/v1/workspaces/{project_id}/exports",
            json={
                "request": request,
                "preview_token": preview.json()["preview_token"],
                "allow_warnings": False,
            },
        )
        assert created.status_code == 201
        assert created.json()["status"] == "queued"
        assert created.json()["configuration_snapshot"]["packaging"] == "directory"
        assert created.json()["configuration_snapshot"]["directory_layout"] == {
            "mode": "flat",
            "merge_into_parent_paths": [],
        }
        active = client.get("/api/v1/jobs/active")
        assert active.json()["export_count"] == 1

        blocked_edit = client.put(
            f"/api/v1/workspaces/{project_id}/assets/{asset_id}/annotation",
            json={"content": "changed", "expected_modified_at": None},
        )
        assert blocked_edit.status_code == 400
        assert "正在导出" in blocked_edit.json()["detail"]

        stopped = client.post(
            f"/api/v1/workspaces/{project_id}/exports/{created.json()['id']}/stop"
        )
        assert stopped.status_code == 200
        assert stopped.json()["status"] == "stopped"
