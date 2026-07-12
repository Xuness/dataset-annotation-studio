from pathlib import Path

import pytest
from PIL import Image

from dataset_studio.core.config import Settings
from dataset_studio.core.files import file_sha256
from dataset_studio.modules.assets.service import AssetService
from dataset_studio.modules.preprocessing.models import (
    ConvertOptions,
    OutputFormat,
    PreprocessExecuteRequest,
    PreprocessPreview,
    PreprocessRequest,
    ResizeOptions,
)
from dataset_studio.modules.preprocessing.service import PreprocessService
from dataset_studio.modules.workspaces.repository import WorkspaceRegistry
from dataset_studio.modules.workspaces.service import WorkspaceService
from dataset_studio.platform.global_store import initialize_global_database


def _services(tmp_path: Path):
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    settings.ensure_directories()
    global_database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(global_database)
    workspaces = WorkspaceService(settings, WorkspaceRegistry(global_database))
    return workspaces, AssetService(workspaces), PreprocessService(workspaces)


def _execute(
    preprocessing: PreprocessService,
    project_id: str,
    request: PreprocessRequest,
    preview: PreprocessPreview | None = None,
):
    preview = preview or preprocessing.preview(project_id, request)
    return preprocessing.execute(
        project_id,
        PreprocessExecuteRequest(request=request, preview_token=preview.preview_token),
    )


def test_resize_convert_and_undo_preserves_asset_identity(tmp_path: Path) -> None:
    workspaces, assets, preprocessing = _services(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    Image.new("RGB", (400, 200), (220, 200, 180)).save(project / "sample.png")
    (project / "sample.txt").write_text("<caption>kept</caption>", encoding="utf-8")
    summary, _ = workspaces.open(str(project))
    before = assets.list_assets(summary.project_id).items[0]
    request = PreprocessRequest(
        resize=ResizeOptions(max_edge=100, allow_upscale=False),
        convert=ConvertOptions(format=OutputFormat.WEBP, quality=88, effort=4),
    )

    preview = preprocessing.preview(summary.project_id, request)
    assert preview.changed_count == 1
    assert preview.items[0].after_width == 100
    assert preview.items[0].after_height == 50

    operation = _execute(preprocessing, summary.project_id, request, preview)
    assert operation.status == "completed"
    assert not (project / "sample.png").exists()
    assert (project / "sample.webp").is_file()
    assert (project / "sample.txt").is_file()
    with Image.open(project / "sample.webp") as image:
        assert image.size == (100, 50)
    after = assets.list_assets(summary.project_id).items[0]
    assert after.id == before.id
    assert after.relative_path == "sample.webp"
    recovery = project / ".annotation-workspace" / "recovery" / operation.id
    assert (recovery / "files" / "sample.png").is_file()

    undone = preprocessing.undo(summary.project_id, operation.id)
    assert undone.status == "undone"
    assert (project / "sample.png").is_file()
    assert not (project / "sample.webp").exists()
    restored = assets.list_assets(summary.project_id).items[0]
    assert restored.id == before.id
    assert restored.relative_path == "sample.png"
    with Image.open(project / "sample.png") as image:
        assert image.size == (400, 200)


def test_failed_asset_update_restores_original_file(tmp_path: Path, monkeypatch) -> None:
    workspaces, _, preprocessing = _services(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    Image.new("RGB", (320, 160), "white").save(project / "sample.png")
    summary, _ = workspaces.open(str(project))
    request = PreprocessRequest(
        resize=ResizeOptions(max_edge=100),
        convert=ConvertOptions(format=OutputFormat.WEBP),
    )

    def fail_asset_update(*_args, **_kwargs):
        raise RuntimeError("simulated database failure")

    monkeypatch.setattr(preprocessing, "_update_asset", fail_asset_update)
    with pytest.raises(RuntimeError, match="simulated database failure"):
        _execute(preprocessing, summary.project_id, request)

    assert (project / "sample.png").is_file()
    assert not (project / "sample.webp").exists()
    with Image.open(project / "sample.png") as image:
        assert image.size == (320, 160)


def test_execute_rejects_stale_preview_parameters_and_source(tmp_path: Path) -> None:
    workspaces, _, preprocessing = _services(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    image_path = project / "sample.png"
    Image.new("RGB", (192, 96), "white").save(image_path)
    summary, _ = workspaces.open(str(project))
    request = PreprocessRequest(resize=ResizeOptions(max_edge=64))
    preview = preprocessing.preview(summary.project_id, request)

    changed_request = PreprocessRequest(resize=ResizeOptions(max_edge=96))
    with pytest.raises(ValueError, match="预览已失效"):
        preprocessing.execute(
            summary.project_id,
            PreprocessExecuteRequest(
                request=changed_request,
                preview_token=preview.preview_token,
            ),
        )
    assert Image.open(image_path).size == (192, 96)

    Image.new("RGB", (192, 96), "black").save(image_path)
    with pytest.raises(ValueError, match="预览已失效"):
        preprocessing.execute(
            summary.project_id,
            PreprocessExecuteRequest(request=request, preview_token=preview.preview_token),
        )
    assert Image.open(image_path).size == (192, 96)


def test_exif_orientation_is_applied_to_preview_and_output(tmp_path: Path) -> None:
    workspaces, _, preprocessing = _services(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    source = project / "rotated.jpg"
    exif = Image.Exif()
    exif[274] = 6
    Image.new("RGB", (120, 60), "white").save(source, exif=exif)
    summary, _ = workspaces.open(str(project))
    request = PreprocessRequest(convert=ConvertOptions(format=OutputFormat.PNG))

    preview = preprocessing.preview(summary.project_id, request)
    assert (preview.items[0].before_width, preview.items[0].before_height) == (60, 120)
    operation = _execute(preprocessing, summary.project_id, request, preview)

    assert operation.status == "completed"
    with Image.open(project / "rotated.png") as output:
        assert output.size == (60, 120)
        assert output.format == "PNG"


@pytest.mark.parametrize(
    ("suffix", "expected_format"),
    [(".bmp", "BMP"), (".tiff", "TIFF")],
)
def test_resize_without_conversion_preserves_file_format(
    tmp_path: Path,
    suffix: str,
    expected_format: str,
) -> None:
    workspaces, _, preprocessing = _services(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    image_path = project / f"sample{suffix}"
    Image.new("RGB", (160, 80), "white").save(image_path)
    summary, _ = workspaces.open(str(project))
    request = PreprocessRequest(resize=ResizeOptions(max_edge=64))

    _execute(preprocessing, summary.project_id, request)

    with Image.open(image_path) as output:
        assert output.size == (64, 32)
        assert output.format == expected_format


def test_cmyk_image_can_be_converted_to_png(tmp_path: Path) -> None:
    workspaces, _, preprocessing = _services(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    Image.new("CMYK", (96, 64), (0, 120, 120, 0)).save(project / "cmyk.jpg")
    summary, _ = workspaces.open(str(project))
    request = PreprocessRequest(convert=ConvertOptions(format=OutputFormat.PNG))

    _execute(preprocessing, summary.project_id, request)

    with Image.open(project / "cmyk.png") as output:
        assert output.mode == "RGB"
        assert output.format == "PNG"


def test_undo_refuses_to_overwrite_new_file_at_original_path(tmp_path: Path) -> None:
    workspaces, _, preprocessing = _services(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    original = project / "sample.png"
    Image.new("RGB", (160, 80), "white").save(original)
    summary, _ = workspaces.open(str(project))
    request = PreprocessRequest(convert=ConvertOptions(format=OutputFormat.WEBP))
    operation = _execute(preprocessing, summary.project_id, request)

    Image.new("RGB", (32, 32), "red").save(original)
    new_file_hash = file_sha256(original)
    with pytest.raises(ValueError, match="原路径已出现新文件"):
        preprocessing.undo(summary.project_id, operation.id)

    assert file_sha256(original) == new_file_hash
    assert (project / "sample.webp").is_file()
    assert preprocessing.list_operations(summary.project_id)[0].status == "completed"


def test_conversion_collision_is_reported_and_not_executed(tmp_path: Path) -> None:
    workspaces, _, preprocessing = _services(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    Image.new("RGB", (64, 64), "white").save(project / "same.jpg")
    Image.new("RGB", (64, 64), "black").save(project / "same.png")
    summary, _ = workspaces.open(str(project))
    request = PreprocessRequest(convert=ConvertOptions(format=OutputFormat.WEBP))

    preview = preprocessing.preview(summary.project_id, request)
    assert preview.warning_count == 2
    assert all(item.warning and "同一目标" in item.warning for item in preview.items)
    with pytest.raises(ValueError, match="同一目标"):
        _execute(preprocessing, summary.project_id, request, preview)

    assert (project / "same.jpg").is_file()
    assert (project / "same.png").is_file()
    assert not (project / "same.webp").exists()


def test_multiframe_image_is_not_silently_flattened(tmp_path: Path) -> None:
    workspaces, _, preprocessing = _services(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    image_path = project / "pages.tiff"
    first = Image.new("RGB", (128, 64), "white")
    second = Image.new("RGB", (128, 64), "black")
    first.save(image_path, save_all=True, append_images=[second])
    summary, _ = workspaces.open(str(project))
    request = PreprocessRequest(resize=ResizeOptions(max_edge=64))

    preview = preprocessing.preview(summary.project_id, request)

    assert preview.warning_count == 1
    assert "多帧图片" in (preview.items[0].warning or "")
    with pytest.raises(ValueError, match="多帧图片"):
        _execute(preprocessing, summary.project_id, request, preview)
    with Image.open(image_path) as image:
        assert image.n_frames == 2


def test_workspace_file_operations_are_mutually_exclusive(tmp_path: Path) -> None:
    workspaces, _, preprocessing = _services(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    Image.new("RGB", (128, 64), "white").save(project / "sample.png")
    summary, _ = workspaces.open(str(project))
    request = PreprocessRequest(resize=ResizeOptions(max_edge=64))
    preview = preprocessing.preview(summary.project_id, request)

    with preprocessing.guard_workspace(summary.project_id, "test-scan"):
        assert preprocessing.is_project_active(summary.project_id)
        with pytest.raises(ValueError, match="正在执行"):
            _execute(preprocessing, summary.project_id, request, preview)

    assert not preprocessing.is_project_active(summary.project_id)


def test_preprocessing_refuses_to_run_while_annotation_job_is_active(tmp_path: Path) -> None:
    workspaces, _, _ = _services(tmp_path)
    preprocessing = PreprocessService(workspaces, has_active_jobs=lambda _project_id: True)
    project = tmp_path / "dataset"
    project.mkdir()
    image_path = project / "sample.png"
    Image.new("RGB", (128, 64), "white").save(image_path)
    summary, _ = workspaces.open(str(project))
    request = PreprocessRequest(resize=ResizeOptions(max_edge=64))
    preview = preprocessing.preview(summary.project_id, request)

    with pytest.raises(ValueError, match="标注任务运行"):
        _execute(preprocessing, summary.project_id, request, preview)

    with Image.open(image_path) as image:
        assert image.size == (128, 64)


def test_failed_multi_item_undo_restores_already_undone_items(
    tmp_path: Path,
    monkeypatch,
) -> None:
    workspaces, assets, preprocessing = _services(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    Image.new("RGB", (128, 64), "white").save(project / "a.png")
    Image.new("RGB", (128, 64), "black").save(project / "b.png")
    summary, _ = workspaces.open(str(project))
    request = PreprocessRequest(convert=ConvertOptions(format=OutputFormat.WEBP))
    operation = _execute(preprocessing, summary.project_id, request)
    original_update = PreprocessService._update_asset
    calls = 0

    def fail_second_update(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("simulated undo database failure")
        return original_update(*args, **kwargs)

    monkeypatch.setattr(
        PreprocessService,
        "_update_asset",
        staticmethod(fail_second_update),
    )
    with pytest.raises(RuntimeError, match="simulated undo database failure"):
        preprocessing.undo(summary.project_id, operation.id)

    assert not (project / "a.png").exists()
    assert not (project / "b.png").exists()
    assert (project / "a.webp").is_file()
    assert (project / "b.webp").is_file()
    assert [item.relative_path for item in assets.list_assets(summary.project_id).items] == [
        "a.webp",
        "b.webp",
    ]
    assert preprocessing.list_operations(summary.project_id)[0].status == "completed"


def test_failed_multi_item_execution_rolls_back_completed_items(
    tmp_path: Path,
    monkeypatch,
) -> None:
    workspaces, assets, preprocessing = _services(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    Image.new("RGB", (128, 64), "white").save(project / "a.png")
    Image.new("RGB", (128, 64), "black").save(project / "b.png")
    summary, _ = workspaces.open(str(project))
    request = PreprocessRequest(convert=ConvertOptions(format=OutputFormat.WEBP))
    preview = preprocessing.preview(summary.project_id, request)
    original_update = PreprocessService._update_asset
    calls = 0

    def fail_second_update(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("simulated execution database failure")
        return original_update(*args, **kwargs)

    monkeypatch.setattr(
        PreprocessService,
        "_update_asset",
        staticmethod(fail_second_update),
    )
    with pytest.raises(RuntimeError, match="simulated execution database failure"):
        _execute(preprocessing, summary.project_id, request, preview)

    assert (project / "a.png").is_file()
    assert (project / "b.png").is_file()
    assert not (project / "a.webp").exists()
    assert not (project / "b.webp").exists()
    assert [item.relative_path for item in assets.list_assets(summary.project_id).items] == [
        "a.png",
        "b.png",
    ]
    assert preprocessing.list_operations(summary.project_id)[0].status == "failed"
