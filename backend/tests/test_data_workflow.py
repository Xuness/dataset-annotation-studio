from __future__ import annotations

import asyncio
import base64
import io
import json
import random
import tempfile
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from PIL import Image

from dataset_studio.core.config import Settings
from dataset_studio.core.files import file_sha256
from dataset_studio.core.migrations import migrate_database
from dataset_studio.modules.annotations.models import AnnotationChannel, AnnotationTag
from dataset_studio.modules.assets.deletions.models import (
    AssetDeletionExecuteRequest,
    AssetDeletionRequest,
)
from dataset_studio.modules.assets.deletions.service import AssetDeletionService
from dataset_studio.modules.exports.models import (
    ExportChannelSelection,
    ExportCreateRequest,
    ExportDirectoryLayout,
    ExportRequest,
)
from dataset_studio.modules.jobs.models import JobCreateRequest, JobScope, JobStatus
from dataset_studio.modules.jobs.worker import AnnotationWorker
from dataset_studio.modules.preprocessing.models import (
    PreprocessExecuteRequest,
    PreprocessRequest,
    RenameOptions,
    ResizeOptions,
)
from dataset_studio.modules.preprocessing.service import PreprocessService
from dataset_studio.modules.presets.models import ProviderProfileCreate, SystemPresetCreate
from dataset_studio.modules.providers.config import (
    OpenAICompatibleModelOptions,
    ProviderModelConfig,
    ProviderType,
)
from dataset_studio.modules.providers.inference_images import (
    InferenceImageError,
    prepare_inference_image,
)
from dataset_studio.modules.workspaces.backups import (
    RestoreExecution,
    RestoreRequest,
    list_originals,
    restore_files,
    restore_preview,
)
from dataset_studio.modules.workspaces.models import WorkspaceManifest, WorkspaceSettingsUpdate
from dataset_studio.modules.workspaces.paths import WorkspacePaths
from dataset_studio.modules.workspaces.repository import WorkspaceRegistry
from dataset_studio.modules.workspaces.schema import WORKSPACE_MIGRATIONS
from dataset_studio.modules.workspaces.service import WorkspaceService
from dataset_studio.platform.global_store import initialize_global_database
from test_exports import _run_export, _services, _write_image
from test_worker_flow import _runtime


def test_source_export_reuses_images_and_preserves_original_annotation(tmp_path: Path) -> None:
    workspaces, assets, annotations, exports = _services(tmp_path)
    root = tmp_path / "dataset"
    _write_image(root / "nested" / "image.png")
    sidecar = root / "nested" / "image.txt"
    sidecar.write_text("original", encoding="utf-8")
    summary, _ = workspaces.open(str(root))
    asset = assets.list_assets(summary.project_id).items[0]
    annotations.save_tags(
        summary.project_id, asset.id, [AnnotationTag(name="blue_hair", origin="manual")]
    )
    annotations.save_text(
        summary.project_id, asset.id, AnnotationChannel.DESCRIPTION, "description"
    )
    request = ExportRequest(
        destination_kind="source",
        content_mode="images_and_annotations",
        directory_layout=ExportDirectoryLayout(mode="preserve"),
        channels=[
            ExportChannelSelection(channel="tags"),
            ExportChannelSelection(channel="description"),
        ],
        primary_txt_channel_key="tags",
        conflict_policy="replace_annotations",
        formats=["txt", "json"],
    )
    original_image = file_sha256(root / "nested" / "image.png")
    preview = exports.preview(summary.project_id, request)
    assert preview.replaced_file_count == 1
    assert preview.image_bytes == 0
    operation = exports.create(
        summary.project_id,
        ExportCreateRequest(request=request, preview_token=preview.preview_token),
    )
    _run_export(workspaces, summary.project_id, operation.id)
    assert exports.get(summary.project_id, operation.id).status == "completed"
    assert sidecar.read_text() == "blue_hair"
    assert sidecar.with_name("image.description.txt").read_text() == "description"
    assert sidecar.with_name("image.annotations.json").is_file()
    assert file_sha256(root / "nested" / "image.png") == original_image
    paths, _ = workspaces.get(summary.project_id)
    assert not (root / ".annotation-workspace").exists()
    originals = list_originals(paths)
    assert len(originals) == 1
    assert (paths.internal / originals[0].backup_relative_path).read_text() == "original"
    repeated = exports.preview(summary.project_id, request)
    assert repeated.reused_file_count == 4
    assert repeated.image_bytes + repeated.annotation_bytes == 0
    operation2 = exports.create(
        summary.project_id,
        ExportCreateRequest(request=request, preview_token=repeated.preview_token),
    )
    _run_export(workspaces, summary.project_id, operation2.id)
    assert exports.get(summary.project_id, operation2.id).status == "completed"
    preprocessing = PreprocessService(workspaces, has_active_jobs=lambda _: False)
    rename = PreprocessRequest(rename=RenameOptions(template="renamed"))
    rename_preview = preprocessing.preview(summary.project_id, rename)
    renamed = preprocessing.execute(
        summary.project_id,
        PreprocessExecuteRequest(request=rename, preview_token=rename_preview.preview_token),
    )
    for suffix in (".txt", ".description.txt", ".annotations.json"):
        assert (root / "nested" / ("renamed" + suffix)).is_file()
        assert not (root / "nested" / ("image" + suffix)).exists()
    preprocessing.undo(summary.project_id, renamed.id)
    for suffix in (".txt", ".description.txt", ".annotations.json"):
        assert (root / "nested" / ("image" + suffix)).is_file()
    preprocessing.close()


def test_preview_checks_only_planned_targets_and_rejects_changes(tmp_path: Path) -> None:
    workspaces, _, _, exports = _services(tmp_path)
    root = tmp_path / "dataset"
    _write_image(root / "image.png")
    (root / "image.txt").write_text("source", encoding="utf-8")
    summary, _ = workspaces.open(str(root))
    target = tmp_path / "output"
    target.mkdir()
    (target / "unrelated.txt").write_text("keep", encoding="utf-8")
    request = ExportRequest(destination_path=str(target), content_mode="annotations_only")
    preview = exports.preview(summary.project_id, request)
    (target / "another.txt").write_text("also keep", encoding="utf-8")
    assert exports.preview(summary.project_id, request).preview_token == preview.preview_token
    (target / "image.txt").write_text("changed", encoding="utf-8")
    with pytest.raises(ValueError, match="预览已失效"):
        exports.create(
            summary.project_id,
            ExportCreateRequest(request=request, preview_token=preview.preview_token),
        )


def test_original_survives_repeated_preprocessing_and_can_be_restored(tmp_path: Path) -> None:
    workspaces, assets, _, _ = _services(tmp_path)
    root = tmp_path / "dataset"
    root.mkdir()
    Image.new("RGB", (512, 384), "red").save(root / "image.png")
    original = (root / "image.png").read_bytes()
    summary, _ = workspaces.open(str(root))
    preprocessing = PreprocessService(workspaces)
    for edge in (256, 128):
        request = PreprocessRequest(resize=ResizeOptions(max_edge=edge))
        preview = preprocessing.preview(summary.project_id, request)
        preprocessing.execute(
            summary.project_id,
            PreprocessExecuteRequest(request=request, preview_token=preview.preview_token),
        )
    paths, _ = workspaces.get(summary.project_id)
    backups = list_originals(paths)
    assert len(backups) == 1
    assert (paths.internal / backups[0].backup_relative_path).read_bytes() == original
    target = tmp_path / "restored"
    target.mkdir()
    request = RestoreRequest(
        backup_ids=[backups[0].id],
        destination_kind="directory",
        destination_path=str(target),
        allow_replace=False,
    )
    preview = restore_preview(paths, request)
    restore_files(paths, RestoreExecution(request=request, preview_token=preview.preview_token))
    assert (target / "image.png").read_bytes() == original
    assert assets.list_assets(summary.project_id).items[0].width == 128
    request = request.model_copy(update={"destination_kind": "source", "allow_replace": True})
    preview = restore_preview(paths, request)
    restore_files(paths, RestoreExecution(request=request, preview_token=preview.preview_token))
    workspaces.rescan(summary.project_id)
    assert assets.list_assets(summary.project_id).items[0].width == 512
    preprocessing.close()


def test_workspace_identity_overlap_and_legacy_copy(tmp_path: Path) -> None:
    workspaces, _, _, _ = _services(tmp_path)
    root = tmp_path / "dataset"
    _write_image(root / "nested" / "image.png")
    legacy = WorkspacePaths.from_root(root, workspaces.settings)
    legacy.ensure_directories()
    manifest = WorkspaceManifest(
        project_id=str(uuid.uuid4()), name="dataset", created_at="2026-01-01T00:00:00Z"
    )
    legacy.manifest.write_text(manifest.model_dump_json(), encoding="utf-8")
    migrate_database(legacy.database, WORKSPACE_MIGRATIONS[:21])
    before = legacy.database.read_bytes()
    summary, _ = workspaces.open(str(root))
    assert summary.project_id == manifest.project_id
    assert legacy.database.read_bytes() == before
    assert workspaces.open(str(root))[0].project_id == manifest.project_id
    alias = tmp_path / "alias"
    alias.symlink_to(root, target_is_directory=True)
    assert workspaces.open(str(alias))[0].project_id == manifest.project_id
    workspaces.remove_recent(summary.project_id)
    with pytest.raises(ValueError, match="重叠"):
        workspaces.open(str(root / "nested"))


@pytest.mark.parametrize("limit_offset", [-1, 0, 1])
def test_inference_threshold_preserves_source(tmp_path: Path, limit_offset: int) -> None:
    source = tmp_path / "image.png"
    Image.frombytes("RGB", (256, 256), random.Random(1).randbytes(256 * 256 * 3)).save(source)
    original = source.read_bytes()
    limit = len(original) + limit_offset
    prepared = prepare_inference_image(source, tmp_path / "cache", limit, file_sha256(source))
    assert source.read_bytes() == original
    assert prepared.byte_size <= limit
    assert prepared.compressed == (limit_offset == -1)
    if limit_offset >= 0:
        assert prepared.path == source
        assert not (tmp_path / "cache").exists()


def test_inference_alpha_and_impossible_limit(tmp_path: Path) -> None:
    source = tmp_path / "transparent.png"
    Image.frombytes("RGBA", (256, 256), random.Random(2).randbytes(256 * 256 * 4)).save(source)
    prepared = prepare_inference_image(source, tmp_path / "cache", 30_000, file_sha256(source))
    with Image.open(prepared.path) as image:
        assert image.mode == "RGBA"
        assert image.getchannel("A").getextrema()[0] < 255
    with pytest.raises(InferenceImageError, match="上限 1 字节"):
        prepare_inference_image(source, tmp_path / "impossible", 1, file_sha256(source))


def test_real_cross_filesystem_preprocessing_and_deletion(tmp_path: Path) -> None:
    shared = Path("/dev/shm")
    if not shared.is_dir() or shared.stat().st_dev == tmp_path.stat().st_dev:
        pytest.skip("A second real filesystem is required")
    with tempfile.TemporaryDirectory(prefix="dataset-workflow-", dir=shared) as directory:
        settings = Settings(app_data_dir=Path(directory), host="127.0.0.1", port=0)
        settings.ensure_directories()
        database = settings.app_data_dir / "global.sqlite3"
        initialize_global_database(database)
        workspaces = WorkspaceService(settings, WorkspaceRegistry(database))
        root = tmp_path / "dataset"
        root.mkdir()
        Image.new("RGB", (256, 256), "green").save(root / "image.png")
        original = (root / "image.png").read_bytes()
        summary, _ = workspaces.open(str(root))
        preprocessing = PreprocessService(workspaces)
        request = PreprocessRequest(resize=ResizeOptions(max_edge=128))
        preview = preprocessing.preview(summary.project_id, request)
        operation = preprocessing.execute(
            summary.project_id,
            PreprocessExecuteRequest(request=request, preview_token=preview.preview_token),
        )
        preprocessing.undo(summary.project_id, operation.id)
        assert (root / "image.png").read_bytes() == original
        from dataset_studio.modules.assets.service import AssetService

        asset = AssetService(workspaces).list_assets(summary.project_id).items[0]
        deletion = AssetDeletionService(workspaces)
        request_delete = AssetDeletionRequest(asset_ids=[asset.id])
        preview_delete = deletion.preview(summary.project_id, request_delete)
        deleted = deletion.execute(
            summary.project_id,
            AssetDeletionExecuteRequest(
                request=request_delete, preview_token=preview_delete.preview_token
            ),
        )
        assert not (root / "image.png").exists()
        deletion.undo(summary.project_id, deleted.id)
        assert (root / "image.png").read_bytes() == original
        preprocessing.close()


@pytest.mark.asyncio
async def test_real_http_llm_receives_compressed_image_and_export_uses_original(
    tmp_path: Path,
) -> None:
    received: list[bytes] = []

    class Receiver(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            image_url = payload["messages"][1]["content"][1]["image_url"]["url"]
            assert image_url.startswith("data:image/jpeg;base64,")
            received.append(base64.b64decode(image_url.split(",", 1)[1]))
            if len(received) == 1:
                self.send_response(503)
                self.send_header("Content-Type", "application/json")
                body = b'{"error":{"message":"retry this request"}}'
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            body = json.dumps(
                {
                    "choices": [
                        {
                            "message": {"content": "<caption>image</caption>"},
                            "finish_reason": "stop",
                        }
                    ],
                    "usage": {},
                }
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Receiver)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    container, workspaces, presets, jobs = _runtime(tmp_path)
    root = tmp_path / "dataset"
    root.mkdir()
    Image.frombytes("RGB", (512, 512), random.Random(3).randbytes(512 * 512 * 3)).save(
        root / "image.png"
    )
    original = (root / "image.png").read_bytes()
    summary, _ = workspaces.open(str(root))
    system = presets.create_system(SystemPresetCreate(name="test", system_prompt="Describe."))
    workspaces.update_settings(
        summary.project_id, WorkspaceSettingsUpdate(system_preset_id=system.id)
    )
    profile = presets.create_provider(
        ProviderProfileCreate(
            name="Local HTTP",
            provider_type=ProviderType.OPENAI_COMPATIBLE,
            base_url=f"http://127.0.0.1:{server.server_port}/v1",
            api_key="local-test",
            default_model_id="test",
            models=[
                ProviderModelConfig(
                    model_id="test",
                    protocol_options=OpenAICompatibleModelOptions(),
                    inference_image_max_bytes=40_000,
                )
            ],
        )
    )
    job = jobs.create(
        summary.project_id, JobCreateRequest(provider_profile_id=profile.id, scope=JobScope.ALL)
    )
    from dataset_studio.core.sqlite import transaction

    with transaction(workspaces.settings.app_data_dir / "global.sqlite3") as connection:
        connection.execute("UPDATE provider_model_configs SET inference_image_max_bytes=1")
    worker = AnnotationWorker(container)
    stopped = asyncio.Event()
    worker_task = asyncio.create_task(worker.run(stopped))
    try:
        async with asyncio.timeout(15):
            while jobs.get(summary.project_id, job.id).status not in {
                JobStatus.COMPLETED,
                JobStatus.COMPLETED_WITH_ERRORS,
            }:
                await asyncio.sleep(0.05)
        assert jobs.get(summary.project_id, job.id).status == JobStatus.COMPLETED
        assert len(received) == 2 and received[0] == received[1]
        assert len(received[0]) <= 40_000
        with Image.open(io.BytesIO(received[0])) as image:
            image.load()
        assert (root / "image.png").read_bytes() == original
        paths, _ = workspaces.get(summary.project_id)
        assert not list((paths.internal / "cache" / "inference").rglob("*.jpg"))
        target = tmp_path / "export"
        target.mkdir()
        request = ExportRequest(
            destination_path=str(target), channels=[ExportChannelSelection(channel="description")]
        )
        preview = container.exports.preview(summary.project_id, request)
        operation = container.exports.create(
            summary.project_id,
            ExportCreateRequest(request=request, preview_token=preview.preview_token),
        )
        _run_export(workspaces, summary.project_id, operation.id)
        assert (target / "image.png").read_bytes() == original
    finally:
        stopped.set()
        await asyncio.wait_for(worker_task, timeout=3)
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


def test_restore_rejects_changed_target_and_damaged_backup(tmp_path: Path) -> None:
    from dataset_studio.modules.workspaces.backups import preserve_asset_files

    workspaces, assets, _, _ = _services(tmp_path)
    root = tmp_path / "dataset"
    _write_image(root / "image.png")
    summary, _ = workspaces.open(str(root))
    paths, _ = workspaces.get(summary.project_id)
    asset = assets.list_assets(summary.project_id).items[0]
    preserve_asset_files(paths, asset.id, root / "image.png")
    backup = list_originals(paths)[0]
    destination = tmp_path / "restored"
    destination.mkdir()
    request = RestoreRequest(
        backup_ids=[backup.id],
        destination_kind="directory",
        destination_path=str(destination),
        allow_replace=False,
    )
    preview = restore_preview(paths, request)
    target = destination / "image.png"
    target.write_bytes(b"external change")
    with pytest.raises(ValueError, match="预览已失效"):
        restore_files(paths, RestoreExecution(request=request, preview_token=preview.preview_token))
    assert target.read_bytes() == b"external change"
    target.unlink()
    (paths.internal / backup.backup_relative_path).write_bytes(b"damaged backup")
    assert restore_preview(paths, request).blocking_issues
    with pytest.raises(ValueError):
        restore_files(paths, RestoreExecution(request=request, preview_token=preview.preview_token))
    assert not target.exists()


def test_export_recognizes_commit_before_journal_completion(tmp_path: Path) -> None:
    from dataset_studio.modules.exports.repository import ExportRepository

    workspaces, _, _, exports = _services(tmp_path)
    root = tmp_path / "dataset"
    _write_image(root / "image.png")
    (root / "image.txt").write_text("before", encoding="utf-8")
    summary, _ = workspaces.open(str(root))
    paths, _ = workspaces.get(summary.project_id)
    destination = tmp_path / "output"
    destination.mkdir()
    target = destination / "image.txt"
    target.write_text("replace me", encoding="utf-8")
    request = ExportRequest(
        destination_path=str(destination),
        content_mode="annotations_only",
        conflict_policy="replace_annotations",
    )
    preview = exports.preview(summary.project_id, request)
    operation = exports.create(
        summary.project_id,
        ExportCreateRequest(request=request, preview_token=preview.preview_token),
    )
    backup = paths.recovery / "exports" / operation.id / "image.txt"
    backup.parent.mkdir(parents=True)
    backup.write_text("replace me", encoding="utf-8")
    repository = ExportRepository(paths.database)
    repository.record_file(
        operation.id, "image.txt", "prepared", backup.relative_to(paths.internal).as_posix()
    )
    target.write_text("before", encoding="utf-8")
    _run_export(workspaces, summary.project_id, operation.id)
    completed = exports.get(summary.project_id, operation.id)
    assert completed.status == "completed"
    assert completed.backup_directory == str(backup.parent)
    assert backup.read_text() == "replace me"
    assert target.read_text() == "before"


def test_inference_orientation_frames_and_source_change(tmp_path: Path) -> None:
    from dataset_studio.modules.providers.inference_images import (
        compress_image,
        validate_inference_source,
    )

    source = tmp_path / "rotated.jpg"
    exif = Image.Exif()
    exif[274] = 6
    Image.new("RGB", (100, 60), "red").save(source, exif=exif)
    result = compress_image(source.read_bytes(), 2000)
    assert (result.width, result.height) == (60, 100)
    prepared = prepare_inference_image(source, tmp_path / "cache", None, file_sha256(source))
    source.write_bytes(b"changed")
    with pytest.raises(InferenceImageError, match="发生变化"):
        validate_inference_source(prepared)
    animated = io.BytesIO()
    Image.new("RGB", (30, 30), "red").save(
        animated, format="GIF", save_all=True, append_images=[Image.new("RGB", (30, 30), "blue")]
    )
    with pytest.raises(InferenceImageError, match="多帧"):
        compress_image(animated.getvalue(), 50)


def test_export_cannot_target_tool_state_through_an_ancestor(tmp_path: Path) -> None:
    workspaces, _, _, exports = _services(tmp_path)
    root = tmp_path / "dataset"
    _write_image(root / "app-data" / "image.png")
    (root / "app-data" / "image.txt").write_text("caption", encoding="utf-8")
    summary, _ = workspaces.open(str(root))
    with pytest.raises(ValueError, match="工具数据目录"):
        exports.preview(
            summary.project_id,
            ExportRequest(
                destination_path=str(tmp_path),
                content_mode="annotations_only",
                directory_layout=ExportDirectoryLayout(mode="preserve"),
            ),
        )
    assert not (tmp_path / "app-data" / "image.txt").exists()
