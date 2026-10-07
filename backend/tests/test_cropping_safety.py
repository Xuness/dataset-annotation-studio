import struct
from contextlib import closing
from io import BytesIO
from pathlib import Path
from typing import Literal

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image, PngImagePlugin
from pydantic import ValidationError

from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.modules.cropping.execution import recover_orphaned
from dataset_studio.modules.cropping.models import (
    CropPlan,
    CropRect,
    Ratio,
    RatioPreset,
    SingleCropRequest,
)
from test_cropping import StudioSession, assets, batch, execute, single, studio

__all__ = ["studio"]


def test_interrupted_batch_and_undo_are_recovered_without_touching_source(
    studio: StudioSession,
) -> None:
    client, project, root = studio
    source = (root / "a.png").read_bytes()
    plan = CropPlan.model_validate(batch(client, project, "all", [], "").json())
    result = execute(client, project, plan).json()
    paths, _ = client.app.state.container.workspaces.get(project)
    with transaction(paths.database) as connection:
        connection.execute(
            "UPDATE crop_operations SET status='running' WHERE id=?", (result["id"],)
        )
        connection.execute(
            "UPDATE preprocess_operations SET status='running' WHERE id=?", (result["id"],)
        )
    assert recover_orphaned(client.app.state.container.workspaces) == 1
    assert len(assets(client, project)) == 2
    assert not list((root / "cropped").rglob("*.png"))
    assert (root / "a.png").read_bytes() == source
    plan = CropPlan.model_validate(batch(client, project, "all", [], "").json())
    result = execute(client, project, plan).json()
    output = root / plan.items[0].output_path
    backup = paths.recovery / result["id"] / "crop-undo"
    backup.mkdir()
    output.rename(backup / f"{plan.items[0].output_id}.png")
    with transaction(paths.database) as connection:
        connection.execute(
            "UPDATE crop_operations SET status='undoing' WHERE id=?", (result["id"],)
        )
        connection.execute(
            "UPDATE preprocess_operations SET status='recovering' WHERE id=?", (result["id"],)
        )
    assert recover_orphaned(client.app.state.container.workspaces) == 1
    assert output.is_file()
    assert (
        client.post(
            f"/api/v1/workspaces/{project}/cropping/operations/{result['id']}/undo"
        ).status_code
        == 200
    )
    assert (root / "a.png").read_bytes() == source


def test_undo_blocks_real_annotation_and_derived_dependency(studio: StudioSession) -> None:
    client, project, root = studio
    source = assets(client, project)[0]
    rect = CropRect(x=0, y=0, width=30, height=30, ratio=None)
    plan = single(client, project, source.id, [rect])
    result = execute(client, project, plan).json()
    generated_id = plan.items[0].output_id
    annotation = client.put(
        f"/api/v1/workspaces/{project}/assets/{generated_id}/annotation",
        json={"content": "new user annotation", "expected_modified_at": None},
    )
    assert annotation.status_code == 200, annotation.text
    undo = client.post(f"/api/v1/workspaces/{project}/cropping/operations/{result['id']}/undo")
    assert undo.status_code == 400 and "标注" in undo.text
    assert (root / plan.items[0].output_path).exists()
    new_plan = single(
        client, project, generated_id, [CropRect(x=0, y=0, width=10, height=10, ratio=None)]
    )
    assert execute(client, project, new_plan).status_code == 200
    assert (
        client.post(
            f"/api/v1/workspaces/{project}/cropping/operations/{result['id']}/undo"
        ).status_code
        == 400
    )


def test_exif_orientation_and_multiframe_rejection(studio: StudioSession) -> None:
    client, project, root = studio
    image = Image.new("RGB", (80, 40), "green")
    exif = image.getexif()
    exif[274] = 6
    image.save(root / "oriented.jpg", exif=exif)
    client.post(f"/api/v1/workspaces/{project}/scan")
    oriented = next(item for item in assets(client, project) if item.filename == "oriented.jpg")
    assert (oriented.width, oriented.height) == (40, 80)
    plan = single(
        client,
        project,
        oriented.id,
        [CropRect(x=0, y=0, width=40, height=80, ratio=None)],
    )
    assert execute(client, project, plan).status_code == 200
    with Image.open(root / plan.items[0].output_path) as result:
        assert result.size == (40, 80)
        assert not result.getexif()
    image.save(
        root / "animated.png", save_all=True, append_images=[Image.new("RGB", (80, 40), "red")]
    )
    client.post(f"/api/v1/workspaces/{project}/scan")
    animated = next(item for item in assets(client, project) if item.filename == "animated.png")
    response = client.post(
        f"/api/v1/workspaces/{project}/cropping/single-preview",
        json=SingleCropRequest(
            asset_id=animated.id, rectangles=[CropRect(x=0, y=0, width=30, height=30, ratio=None)]
        ).model_dump(mode="json"),
    )
    assert response.status_code == 400 and "多帧" in response.text


def test_preview_pages_cover_more_than_first_page_and_no_inheritance(studio: StudioSession) -> None:
    client, project, root = studio
    for index in range(30):
        Image.new("RGB", (33, 55), "white").save(root / f"item-{index}.png")
    client.post(f"/api/v1/workspaces/{project}/scan")
    preview = CropPlan.model_validate(batch(client, project, "all", [], "").json())
    assert preview.total == 32 and len(preview.items) == 24
    second = client.get(
        f"/api/v1/workspaces/{project}/cropping/plans/{preview.id}",
        params={"offset": 24, "limit": 24},
    )
    assert second.status_code == 200 and len(second.json()["items"]) == 8
    assert execute(client, project, preview).status_code == 200
    paths, _ = client.app.state.container.workspaces.get(project)
    with closing(connect(paths.database)) as connection:
        assert connection.execute("SELECT count(*) FROM crop_outputs").fetchone()[0] == 32
        assert (
            connection.execute(
                "SELECT count(*) FROM annotation_documents d JOIN crop_outputs c ON c.id=d.asset_id"
            ).fetchone()[0]
            == 0
        )


def test_output_path_symlink_cannot_escape_workspace(studio: StudioSession, tmp_path: Path) -> None:
    client, project, root = studio
    external = tmp_path / "external"
    external.mkdir()
    (root / "cropped").symlink_to(external, target_is_directory=True)
    response = batch(client, project, "all", [], "")
    assert response.status_code == 400 and "符号链接" in response.text
    assert not list(external.iterdir())


def test_preset_reloads_in_fresh_app_and_second_workspace(
    studio: StudioSession, tmp_path: Path
) -> None:
    client, _, _ = studio
    value = {"name": "durable preset", "ratio": {"width": 2.35, "height": 1}}
    result = client.post("/api/v1/crop-ratio-presets", json=value).json()
    other = tmp_path / "other-project"
    other.mkdir()
    Image.new("RGB", (100, 50), "red").save(other / "picture.png")
    assert client.post("/api/v1/workspaces/open", json={"path": str(other)}).status_code == 200
    from dataset_studio.api.app import create_app

    with TestClient(create_app(client.app.state.container.settings)) as restarted:
        saved = next(
            item
            for item in restarted.get("/api/v1/crop-ratio-presets").json()
            if item["id"] == result["id"]
        )
        assert saved["name"] == value["name"] and saved["ratio"] == value["ratio"]


def test_png_color_information_is_preserved(studio: StudioSession) -> None:
    client, project, root = studio
    metadata = PngImagePlugin.PngInfo()
    metadata.add(b"gAMA", struct.pack(">I", 45455), False)
    metadata.add(b"sRGB", bytes([0]), False)
    Image.new("RGB", (64, 64), "red").save(root / "color.png", pnginfo=metadata)
    assert client.post(f"/api/v1/workspaces/{project}/scan").status_code == 200
    source = next(item for item in assets(client, project) if item.filename == "color.png")
    plan = single(client, project, source.id, [CropRect(x=0, y=0, width=32, height=32, ratio=None)])
    assert execute(client, project, plan).status_code == 200
    with Image.open(root / plan.items[0].output_path) as image:
        assert image.info["gamma"] == 0.45455 and image.info["srgb"] == 0


@pytest.mark.parametrize("suffix", ["png", "tiff"])
def test_high_bit_depth_rgb_is_rejected_before_pillow_precision_loss(
    studio: StudioSession, suffix: str
) -> None:
    client, project, root = studio
    path = root / f"high-depth.{suffix}"
    pixels = np.full((64, 64, 3), 60000, dtype=np.uint16)
    assert cv2.imwrite(str(path), pixels)
    assert client.post(f"/api/v1/workspaces/{project}/scan").status_code == 200
    source = next(item for item in assets(client, project) if item.filename == path.name)
    response = client.post(
        f"/api/v1/workspaces/{project}/cropping/single-preview",
        json=SingleCropRequest(
            asset_id=source.id, rectangles=[CropRect(x=0, y=0, width=32, height=32, ratio=None)]
        ).model_dump(mode="json"),
    )
    assert response.status_code == 400 and "位深" in response.text


@pytest.mark.parametrize(
    ("mode", "transparency", "pixels"),
    [
        pytest.param("1", 0, [0, 255, 255, 0], id="bilevel-key"),
        pytest.param("L", 60, [60, 120, 200, 60], id="grayscale-key"),
        pytest.param("P", 0, [0, 1, 2, 0], id="palette-key"),
        pytest.param("P", bytes([0, 128, 255]), [0, 1, 2, 0], id="palette-alpha-table"),
        pytest.param(
            "RGB",
            (255, 0, 0),
            [(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 0, 0)],
            id="rgb-key",
        ),
        pytest.param("LA", None, [(60, 0), (120, 128), (200, 255), (60, 0)], id="grayscale-alpha"),
        pytest.param(
            "RGBA",
            None,
            [(255, 0, 0, 0), (0, 255, 0, 128), (0, 0, 255, 255), (255, 0, 0, 0)],
            id="rgba-alpha",
        ),
    ],
)
def test_transparency_survives_real_preview_and_png_publication(
    studio: StudioSession,
    mode: Literal["1", "L", "P", "RGB", "LA", "RGBA"],
    transparency: int | bytes | tuple[int, int, int] | None,
    pixels: list[int | tuple[int, int] | tuple[int, int, int] | tuple[int, int, int, int]],
) -> None:
    client, project, root = studio
    path = root / "transparent.png"
    image = Image.new(mode, (4, 4))
    if mode == "P":
        image.putpalette([255, 0, 0, 0, 255, 0, 0, 0, 255] + [0] * 759)
    image.putdata(pixels * 4)
    if transparency is None:
        image.save(path)
    else:
        image.save(path, transparency=transparency)
    original = path.read_bytes()
    with Image.open(path) as source:
        expected = source.convert("RGBA")
    assert expected.getchannel("A").getextrema() == (0, 255)
    assert client.post(f"/api/v1/workspaces/{project}/scan").status_code == 200
    asset = next(item for item in assets(client, project) if item.filename == path.name)
    rectangles = [
        CropRect(x=0, y=0, width=4, height=4, ratio=None),
        CropRect(x=1, y=1, width=3, height=2, ratio=None),
    ]
    plan = single(client, project, asset.id, rectangles)
    for index, rectangle in enumerate(rectangles):
        prefix = f"/api/v1/workspaces/{project}/cropping/plans/{plan.id}/items/{index}"
        for endpoint, expected_image in (
            ("source", expected),
            (
                "result",
                expected.crop(
                    (
                        rectangle.x,
                        rectangle.y,
                        rectangle.x + rectangle.width,
                        rectangle.y + rectangle.height,
                    )
                ),
            ),
        ):
            response = client.get(f"{prefix}/{endpoint}")
            assert response.status_code == 200, response.text
            with Image.open(BytesIO(response.content)) as preview:
                assert preview.size == expected_image.size
                assert preview.convert("RGBA").tobytes() == expected_image.tobytes()
    result = execute(client, project, plan)
    assert result.status_code == 200, result.text
    for item in plan.items:
        rectangle = item.rectangle
        expected_crop = expected.crop(
            (
                rectangle.x,
                rectangle.y,
                rectangle.x + rectangle.width,
                rectangle.y + rectangle.height,
            )
        )
        with Image.open(root / item.output_path) as output:
            assert output.format == "PNG" and output.size == expected_crop.size
            assert output.convert("RGBA").tobytes() == expected_crop.tobytes()
    assert path.read_bytes() == original


@pytest.mark.parametrize(("width", "height"), [(1e-300, 1e300), (1e300, 1e-300)])
def test_unrepresentable_ratio_factor_is_rejected_before_planning_or_persisting(
    studio: StudioSession, width: float, height: float
) -> None:
    client, project, root = studio
    ratio = {"width": width, "height": height}
    with pytest.raises(ValidationError, match="比例因子"):
        Ratio(width=width, height=height)
    original = {path: path.read_bytes() for path in root.rglob("*.png")}
    created = client.post(
        "/api/v1/crop-ratio-presets",
        json={"name": "stable", "ratio": {"width": 1, "height": 1}},
    )
    assert created.status_code == 200, created.text
    preset = RatioPreset.model_validate(created.json())
    source = assets(client, project)[0]
    responses = [
        client.post(
            f"/api/v1/workspaces/{project}/cropping/batch-preview",
            json={
                "scope": "all",
                "asset_ids": [],
                "filters": {"search": "", "status": None, "folder_path": ""},
                "ratio": ratio,
            },
        ),
        client.post(
            f"/api/v1/workspaces/{project}/cropping/single-preview",
            json={
                "asset_id": source.id,
                "rectangles": [
                    {"x": 0, "y": 0, "width": 10, "height": 10, "ratio": ratio},
                ],
            },
        ),
        client.post("/api/v1/crop-ratio-presets", json={"name": "invalid", "ratio": ratio}),
        client.put(
            f"/api/v1/crop-ratio-presets/{preset.id}", json={"name": "invalid", "ratio": ratio}
        ),
    ]
    for response in responses:
        assert response.status_code == 422, response.text
        assert "比例因子" in response.text and "浮点" in response.text
    persisted = [
        RatioPreset.model_validate(item) for item in client.get("/api/v1/crop-ratio-presets").json()
    ]
    assert [item for item in persisted if not item.builtin] == [preset]
    paths, _ = client.app.state.container.workspaces.get(project)
    with closing(connect(paths.database)) as connection:
        assert connection.execute("SELECT count(*) FROM crop_plans").fetchone()[0] == 0
        assert connection.execute("SELECT count(*) FROM crop_operations").fetchone()[0] == 0
    assert {path: path.read_bytes() for path in root.rglob("*.png")} == original


@pytest.mark.parametrize("component", [1e-300, 1e300])
def test_extreme_finite_components_with_representable_ratio_still_execute(
    studio: StudioSession, component: float
) -> None:
    client, project, root = studio
    response = client.post(
        f"/api/v1/workspaces/{project}/cropping/batch-preview",
        json={
            "scope": "all",
            "asset_ids": [],
            "filters": {"search": "", "status": None, "folder_path": ""},
            "ratio": {"width": component, "height": component},
        },
    )
    assert response.status_code == 200, response.text
    plan = CropPlan.model_validate(response.json())
    result = execute(client, project, plan)
    assert result.status_code == 200, result.text
    for item in plan.items:
        with Image.open(root / item.output_path) as output:
            assert output.width == output.height
