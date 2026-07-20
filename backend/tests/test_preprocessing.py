import threading
from pathlib import Path

import pytest
from PIL import Image

from dataset_studio.core.config import Settings
from dataset_studio.core.files import file_sha256
from dataset_studio.core.sqlite import connect
from dataset_studio.modules.assets.service import AssetService
from dataset_studio.modules.preprocessing import executor as preprocessing_executor
from dataset_studio.modules.preprocessing import image_pipeline as preprocessing_image_pipeline
from dataset_studio.modules.preprocessing.models import (
    ConvertOptions,
    OutputFormat,
    PreprocessExecuteRequest,
    PreprocessExecutionOptions,
    PreprocessPreview,
    PreprocessRequest,
    RenameOptions,
    ResizeAlgorithm,
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
    execution: PreprocessExecutionOptions | None = None,
):
    preview = preview or preprocessing.preview(project_id, request)
    return preprocessing.execute(
        project_id,
        PreprocessExecuteRequest(
            request=request,
            preview_token=preview.preview_token,
            execution=execution or PreprocessExecutionOptions(),
        ),
    )


def test_resize_algorithm_defaults_and_low_halo_filter_selection() -> None:
    assert ResizeOptions(max_edge=64).algorithm == ResizeAlgorithm.LANCZOS3
    assert (
        preprocessing_image_pipeline._select_pillow_resampling(
            (256, 128),
            (128, 64),
            ResizeAlgorithm.ANIME_LOW_HALO,
        )
        == Image.Resampling.BOX
    )
    assert (
        preprocessing_image_pipeline._select_pillow_resampling(
            (150, 75),
            (100, 50),
            ResizeAlgorithm.ANIME_LOW_HALO,
        )
        == Image.Resampling.HAMMING
    )
    assert (
        preprocessing_image_pipeline._select_pillow_resampling(
            (64, 32),
            (128, 64),
            ResizeAlgorithm.ANIME_LOW_HALO,
        )
        == Image.Resampling.HAMMING
    )


@pytest.mark.parametrize(
    ("mode", "transparency", "expected_mode"),
    [
        ("P", None, "RGB"),
        ("P", 0, "RGBA"),
        ("1", None, "RGB"),
    ],
)
def test_indexed_and_one_bit_images_convert_before_resizing(
    mode: str,
    transparency: int | None,
    expected_mode: str,
) -> None:
    image = Image.new(mode, (64, 32))
    if mode == "P":
        image.putpalette([0, 0, 0, 255, 255, 255] + [0, 0, 0] * 254)
    for x in range(32, 64):
        for y in range(32):
            image.putpixel((x, y), 1)
    if transparency is not None:
        image.info["transparency"] = transparency

    resized = preprocessing_image_pipeline._resize_image(
        image,
        (128, 64),
        ResizeAlgorithm.LANCZOS3,
    )

    assert resized.mode == expected_mode
    assert resized.size == (128, 64)
    transition_source = resized.getchannel("A") if resized.mode == "RGBA" else resized.convert("L")
    transition = [transition_source.getpixel((x, 32)) for x in range(60, 68)]
    assert any(value not in {0, 255} for value in transition)


def test_lanczos4_uses_opencv_and_preserves_rgba(
    monkeypatch,
) -> None:
    calls: list[int] = []
    original_resize = preprocessing_image_pipeline.cv2.resize

    def observed_resize(*args, **kwargs):
        calls.append(kwargs["interpolation"])
        return original_resize(*args, **kwargs)

    monkeypatch.setattr(preprocessing_image_pipeline.cv2, "resize", observed_resize)
    image = Image.new("RGBA", (64, 32), (255, 0, 0, 0))
    for x in range(32, 64):
        for y in range(32):
            image.putpixel((x, y), (0, 0, 255, 255))

    resized = preprocessing_image_pipeline._resize_image(
        image,
        (128, 64),
        ResizeAlgorithm.LANCZOS4,
    )

    assert calls == [preprocessing_image_pipeline.cv2.INTER_LANCZOS4]
    assert resized.mode == "RGBA"
    assert resized.size == (128, 64)
    assert all(red == 0 for red, _green, _blue, _alpha in resized.get_flattened_data())


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


def test_resize_execution_uses_configured_worker_limit(tmp_path: Path, monkeypatch) -> None:
    workspaces, _, preprocessing = _services(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    for index in range(4):
        Image.new("RGB", (320, 160), (index * 30, 120, 180)).save(project / f"{index}.png")
    summary, _ = workspaces.open(str(project))
    request = PreprocessRequest(resize=ResizeOptions(max_edge=64))
    original_render = preprocessing_executor.render_image_to_staging
    barrier = threading.Barrier(2, timeout=5)
    state_lock = threading.Lock()
    active = 0
    peak_active = 0
    worker_names: set[str] = set()

    def observed_render(*args, **kwargs):
        nonlocal active, peak_active
        with state_lock:
            active += 1
            peak_active = max(peak_active, active)
            worker_names.add(threading.current_thread().name)
        try:
            barrier.wait()
            return original_render(*args, **kwargs)
        finally:
            with state_lock:
                active -= 1

    monkeypatch.setattr(
        preprocessing_executor,
        "render_image_to_staging",
        observed_render,
    )
    operation = _execute(
        preprocessing,
        summary.project_id,
        request,
        execution=PreprocessExecutionOptions(max_workers=2),
    )

    assert operation.status == "completed"
    assert peak_active == 2
    assert len(worker_names) == 2
    assert all(name.startswith("preprocess-resize") for name in worker_names)
    for index in range(4):
        with Image.open(project / f"{index}.png") as image:
            assert image.size == (64, 32)
    operation_root = project / ".annotation-workspace" / "recovery" / operation.id
    assert not (operation_root / "staging").exists()


def test_parallel_resize_can_combine_with_rename_and_undo(tmp_path: Path) -> None:
    workspaces, _, preprocessing = _services(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    original_hashes: dict[str, str] = {}
    for index, name in enumerate(("a", "b", "c")):
        image_path = project / f"{name}.png"
        Image.new("RGB", (320, 160), (index * 40, 100, 200)).save(image_path)
        (project / f"{name}.txt").write_text(f"caption-{name}", encoding="utf-8")
        original_hashes[name] = file_sha256(image_path)
    summary, _ = workspaces.open(str(project))
    request = PreprocessRequest(
        resize=ResizeOptions(max_edge=64),
        rename=RenameOptions(template="resized_{index}", start_index=1, padding=2),
    )

    operation = _execute(
        preprocessing,
        summary.project_id,
        request,
        execution=PreprocessExecutionOptions(max_workers=3),
    )

    for index, name in enumerate(("a", "b", "c"), start=1):
        target = project / f"resized_{index:02}.png"
        with Image.open(target) as image:
            assert image.size == (64, 32)
        assert (project / f"resized_{index:02}.txt").read_text(encoding="utf-8") == (
            f"caption-{name}"
        )
        assert not (project / f"{name}.png").exists()

    preprocessing.undo(summary.project_id, operation.id)
    for name in ("a", "b", "c"):
        assert file_sha256(project / f"{name}.png") == original_hashes[name]
        assert (project / f"{name}.txt").read_text(encoding="utf-8") == f"caption-{name}"


def test_parallel_render_failure_rolls_back_committed_items(tmp_path: Path, monkeypatch) -> None:
    workspaces, assets, preprocessing = _services(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    original_hashes: dict[str, str] = {}
    for index, name in enumerate(("a", "b", "c")):
        image_path = project / f"{name}.png"
        Image.new("RGB", (256, 128), (index * 50, 80, 160)).save(image_path)
        original_hashes[name] = file_sha256(image_path)
    summary, _ = workspaces.open(str(project))
    request = PreprocessRequest(
        resize=ResizeOptions(max_edge=64),
        convert=ConvertOptions(format=OutputFormat.WEBP),
    )
    original_render = preprocessing_executor.render_image_to_staging

    def fail_second_image(source, *args, **kwargs):
        if source.name == "b.png":
            raise RuntimeError("simulated parallel render failure")
        return original_render(source, *args, **kwargs)

    monkeypatch.setattr(
        preprocessing_executor,
        "render_image_to_staging",
        fail_second_image,
    )
    with pytest.raises(RuntimeError, match="simulated parallel render failure"):
        _execute(
            preprocessing,
            summary.project_id,
            request,
            execution=PreprocessExecutionOptions(max_workers=2),
        )

    for name in ("a", "b", "c"):
        assert file_sha256(project / f"{name}.png") == original_hashes[name]
        assert not (project / f"{name}.webp").exists()
    assert [item.relative_path for item in assets.list_assets(summary.project_id).items] == [
        "a.png",
        "b.png",
        "c.png",
    ]
    failed_operation = preprocessing.list_operations(summary.project_id)[0]
    assert failed_operation.status == "failed"
    operation_root = project / ".annotation-workspace" / "recovery" / failed_operation.id
    assert not (operation_root / "staging").exists()


def test_batch_rename_moves_sidecars_without_reencoding_and_undoes(tmp_path: Path) -> None:
    workspaces, assets, preprocessing = _services(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    first_image = project / "a.png"
    second_image = project / "b.jpg"
    Image.new("RGB", (80, 40), "white").save(first_image)
    Image.new("RGB", (64, 32), "black").save(second_image)
    (project / "a.txt").write_text("original annotation", encoding="utf-8")
    (project / "a.json").write_text('{"source": "original"}', encoding="utf-8")
    (project / "a.zh-CN.txt").write_text("简体译文", encoding="utf-8")
    (project / "a.ja.txt").write_text("日本語訳", encoding="utf-8")
    original_hashes = {
        "a.png": file_sha256(first_image),
        "b.jpg": file_sha256(second_image),
    }
    summary, _ = workspaces.open(str(project))
    before_assets = assets.list_assets(summary.project_id).items
    before_ids = {item.filename: item.id for item in before_assets}
    paths, _ = workspaces.get(summary.project_id)
    with connect(paths.database) as connection:
        connection.executemany(
            """
            INSERT INTO annotation_translations (
                asset_id, language, translation_relative_path,
                source_annotation_hash, translation_modified_ns,
                validation_status, created_at, updated_at
            ) VALUES (?, ?, ?, 'source-hash', 1, 'structure_preserved', 'now', 'now')
            """,
            [
                (before_ids["a.png"], "zh-CN", "a.zh-CN.txt"),
                (before_ids["a.png"], "ja", "a.ja.txt"),
            ],
        )
        connection.commit()
    request = PreprocessRequest(
        rename=RenameOptions(template="asset_{index}", start_index=7, padding=3)
    )

    preview = preprocessing.preview(summary.project_id, request)

    assert [item.after_relative_path for item in preview.items] == [
        "asset_007.png",
        "asset_008.jpg",
    ]
    operation = _execute(preprocessing, summary.project_id, request, preview)
    assert not first_image.exists()
    assert not second_image.exists()
    assert file_sha256(project / "asset_007.png") == original_hashes["a.png"]
    assert file_sha256(project / "asset_008.jpg") == original_hashes["b.jpg"]
    assert (project / "asset_007.txt").read_text(encoding="utf-8") == "original annotation"
    assert (project / "asset_007.json").read_text(encoding="utf-8") == '{"source": "original"}'
    assert (project / "asset_007.zh-CN.txt").read_text(encoding="utf-8") == "简体译文"
    assert (project / "asset_007.ja.txt").read_text(encoding="utf-8") == "日本語訳"
    with connect(paths.database) as connection:
        translated_paths = {
            row["language"]: row["translation_relative_path"]
            for row in connection.execute(
                "SELECT language, translation_relative_path FROM annotation_translations"
            )
        }
    assert translated_paths == {
        "zh-CN": "asset_007.zh-CN.txt",
        "ja": "asset_007.ja.txt",
    }
    renamed_assets = assets.list_assets(summary.project_id).items
    assert {item.filename: item.id for item in renamed_assets} == {
        "asset_007.png": before_ids["a.png"],
        "asset_008.jpg": before_ids["b.jpg"],
    }
    assert renamed_assets[0].metadata_relative_path == "asset_007.json"

    (project / "asset_007.txt").write_text("edited after rename", encoding="utf-8")
    (project / "asset_007.zh-CN.txt").write_text("重命名后编辑", encoding="utf-8")
    (project / "asset_007.json").unlink()
    undone = preprocessing.undo(summary.project_id, operation.id)

    assert undone.status == "undone"
    assert file_sha256(first_image) == original_hashes["a.png"]
    assert file_sha256(second_image) == original_hashes["b.jpg"]
    assert (project / "a.txt").read_text(encoding="utf-8") == "edited after rename"
    assert (project / "a.json").read_text(encoding="utf-8") == '{"source": "original"}'
    assert (project / "a.zh-CN.txt").read_text(encoding="utf-8") == "重命名后编辑"
    assert (project / "a.ja.txt").read_text(encoding="utf-8") == "日本語訳"
    with connect(paths.database) as connection:
        restored_paths = {
            row["language"]: row["translation_relative_path"]
            for row in connection.execute(
                "SELECT language, translation_relative_path FROM annotation_translations"
            )
        }
    assert restored_paths == {"zh-CN": "a.zh-CN.txt", "ja": "a.ja.txt"}
    assert not (project / "asset_007.png").exists()
    assert not (project / "asset_008.jpg").exists()


def test_rename_does_not_capture_another_assets_locale_shaped_annotation(
    tmp_path: Path,
) -> None:
    workspaces, assets, preprocessing = _services(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    Image.new("RGB", (80, 40), "white").save(project / "sample.png")
    Image.new("RGB", (64, 32), "black").save(project / "sample.zh-CN.png")
    (project / "sample.txt").write_text("first annotation", encoding="utf-8")
    (project / "sample.zh-CN.txt").write_text("second annotation", encoding="utf-8")
    summary, _ = workspaces.open(str(project))
    by_name = {asset.filename: asset for asset in assets.list_assets(summary.project_id).items}
    request = PreprocessRequest(
        asset_ids=[by_name["sample.png"].id],
        rename=RenameOptions(template="renamed_{index}", start_index=1, padding=2),
    )

    operation = _execute(preprocessing, summary.project_id, request)

    assert operation.status == "completed"
    assert (project / "renamed_01.png").is_file()
    assert (project / "renamed_01.txt").read_text(encoding="utf-8") == "first annotation"
    assert (project / "sample.zh-CN.png").is_file()
    assert (project / "sample.zh-CN.txt").read_text(encoding="utf-8") == ("second annotation")


def test_rename_can_combine_with_conversion(tmp_path: Path) -> None:
    workspaces, _, preprocessing = _services(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    Image.new("RGB", (96, 48), "white").save(project / "sample.png")
    (project / "sample.txt").write_text("caption", encoding="utf-8")
    summary, _ = workspaces.open(str(project))
    request = PreprocessRequest(
        rename=RenameOptions(template="converted_{index}", start_index=1, padding=2),
        convert=ConvertOptions(format=OutputFormat.WEBP),
    )

    operation = _execute(preprocessing, summary.project_id, request)

    assert operation.status == "completed"
    assert (project / "converted_01.webp").is_file()
    assert (project / "converted_01.txt").read_text(encoding="utf-8") == "caption"
    assert not (project / "sample.png").exists()
    assert not (project / "sample.txt").exists()


def test_case_only_rename_and_undo_use_the_requested_filename_casing(tmp_path: Path) -> None:
    workspaces, _, preprocessing = _services(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    Image.new("RGB", (64, 32), "white").save(project / "sample.png")
    (project / "sample.txt").write_text("caption", encoding="utf-8")
    summary, _ = workspaces.open(str(project))
    request = PreprocessRequest(rename=RenameOptions(template="SAMPLE"))

    operation = _execute(preprocessing, summary.project_id, request)

    visible_names = {path.name for path in project.iterdir() if path.is_file()}
    assert {"SAMPLE.png", "SAMPLE.txt"}.issubset(visible_names)
    preprocessing.undo(summary.project_id, operation.id)
    visible_names = {path.name for path in project.iterdir() if path.is_file()}
    assert {"sample.png", "sample.txt"}.issubset(visible_names)


def test_resize_with_case_only_rename_keeps_rendered_output(tmp_path: Path) -> None:
    workspaces, _, preprocessing = _services(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    Image.new("RGB", (160, 80), "white").save(project / "sample.png")
    summary, _ = workspaces.open(str(project))
    request = PreprocessRequest(
        resize=ResizeOptions(max_edge=64),
        rename=RenameOptions(template="SAMPLE"),
    )

    operation = _execute(preprocessing, summary.project_id, request)

    visible_names = {path.name for path in project.iterdir() if path.is_file()}
    assert "SAMPLE.png" in visible_names
    with Image.open(project / "SAMPLE.png") as image:
        assert image.size == (64, 32)

    preprocessing.undo(summary.project_id, operation.id)
    visible_names = {path.name for path in project.iterdir() if path.is_file()}
    assert "sample.png" in visible_names
    with Image.open(project / "sample.png") as image:
        assert image.size == (160, 80)


def test_rename_sidecar_collision_and_invalid_names_are_rejected(tmp_path: Path) -> None:
    workspaces, _, preprocessing = _services(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    Image.new("RGB", (64, 64), "white").save(project / "sample.png")
    (project / "renamed.txt").write_text("occupied", encoding="utf-8")
    summary, _ = workspaces.open(str(project))
    request = PreprocessRequest(rename=RenameOptions(template="renamed"))

    preview = preprocessing.preview(summary.project_id, request)

    assert preview.warning_count == 1
    assert "伴随文件已经存在" in (preview.items[0].warning or "")
    with pytest.raises(ValueError, match="伴随文件已经存在"):
        _execute(preprocessing, summary.project_id, request, preview)
    with pytest.raises(ValueError, match="Windows 保留名称"):
        preprocessing.preview(
            summary.project_id,
            PreprocessRequest(rename=RenameOptions(template="CON")),
        )
    with pytest.raises(ValueError, match="仅支持"):
        RenameOptions(template="image_{number}")


def test_rename_rejects_multiple_images_sharing_a_companion_basename(tmp_path: Path) -> None:
    workspaces, _, preprocessing = _services(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    Image.new("RGB", (64, 64), "white").save(project / "a.jpg")
    Image.new("RGB", (64, 64), "black").save(project / "b.png")
    summary, _ = workspaces.open(str(project))
    request = PreprocessRequest(rename=RenameOptions(template="shared"))

    preview = preprocessing.preview(summary.project_id, request)

    assert preview.warning_count == 2
    assert all(item.warning and "共用同名标注" in item.warning for item in preview.items)
    with pytest.raises(ValueError, match="共用同名标注"):
        _execute(preprocessing, summary.project_id, request, preview)


def test_undo_rename_refuses_to_overwrite_new_sidecar_at_original_path(tmp_path: Path) -> None:
    workspaces, _, preprocessing = _services(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    Image.new("RGB", (64, 32), "white").save(project / "sample.png")
    (project / "sample.txt").write_text("original", encoding="utf-8")
    summary, _ = workspaces.open(str(project))
    request = PreprocessRequest(rename=RenameOptions(template="renamed"))
    operation = _execute(preprocessing, summary.project_id, request)
    (project / "sample.txt").write_text("new occupant", encoding="utf-8")

    with pytest.raises(ValueError, match="原同名伴随路径已出现新文件"):
        preprocessing.undo(summary.project_id, operation.id)

    assert (project / "sample.txt").read_text(encoding="utf-8") == "new occupant"
    assert (project / "renamed.png").is_file()
    assert (project / "renamed.txt").read_text(encoding="utf-8") == "original"
    assert preprocessing.list_operations(summary.project_id)[0].status == "completed"


def test_failed_rename_restores_image_and_sidecars(tmp_path: Path, monkeypatch) -> None:
    workspaces, _, preprocessing = _services(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    image = project / "sample.png"
    Image.new("RGB", (64, 32), "white").save(image)
    (project / "sample.txt").write_text("caption", encoding="utf-8")
    (project / "sample.json").write_text('{"value": 1}', encoding="utf-8")
    original_hash = file_sha256(image)
    summary, _ = workspaces.open(str(project))

    def fail_asset_update(*_args, **_kwargs):
        raise RuntimeError("simulated rename database failure")

    monkeypatch.setattr(preprocessing, "_update_asset", fail_asset_update)
    with pytest.raises(RuntimeError, match="simulated rename database failure"):
        _execute(
            preprocessing,
            summary.project_id,
            PreprocessRequest(rename=RenameOptions(template="renamed_{index}")),
        )

    assert file_sha256(image) == original_hash
    assert (project / "sample.txt").read_text(encoding="utf-8") == "caption"
    assert (project / "sample.json").read_text(encoding="utf-8") == '{"value": 1}'
    assert not (project / "renamed_000001.png").exists()
    assert not (project / "renamed_000001.txt").exists()
    assert not (project / "renamed_000001.json").exists()


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

    changed_algorithm = PreprocessRequest(
        resize=ResizeOptions(max_edge=64, algorithm=ResizeAlgorithm.LANCZOS4)
    )
    with pytest.raises(ValueError, match="预览已失效"):
        preprocessing.execute(
            summary.project_id,
            PreprocessExecuteRequest(
                request=changed_algorithm,
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

    original_hash = file_sha256(image_path)
    rename = PreprocessRequest(rename=RenameOptions(template="renamed_{name}"))
    rename_preview = preprocessing.preview(summary.project_id, rename)
    assert rename_preview.warning_count == 0
    _execute(preprocessing, summary.project_id, rename, rename_preview)
    renamed = project / "renamed_pages.tiff"
    assert file_sha256(renamed) == original_hash
    with Image.open(renamed) as image:
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

    with pytest.raises(ValueError, match="任务运行"):
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
