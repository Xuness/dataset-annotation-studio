from contextlib import closing

import pytest
from PIL import Image

from dataset_studio.core.files import file_sha256
from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.modules.cropping.geometry import centered_rectangle
from dataset_studio.modules.cropping.models import CropPlan, CropRect, Ratio
from dataset_studio.modules.cropping.workbench_models import (
    CropSourceRegions,
    MultiCropRequest,
    PositionedBatchCropRequest,
)
from test_cropping import StudioSession, assets, execute, studio

__all__ = ["studio"]


def request_for(studio: StudioSession) -> MultiCropRequest:
    client, project, _ = studio
    return MultiCropRequest(
        items=[
            CropSourceRegions(
                asset_id=source.id,
                source_version=source.content_version,
                rectangles=[
                    CropRect(x=2, y=3, width=30, height=20, ratio=None),
                    CropRect(x=10, y=12, width=40, height=30, ratio=None),
                ],
            )
            for source in sorted(assets(client, project), key=lambda item: item.relative_path)
        ]
    )


def preview(studio: StudioSession, request: MultiCropRequest) -> CropPlan:
    client, project, _ = studio
    route = (
        "positioned-preview" if isinstance(request, PositionedBatchCropRequest) else "multi-preview"
    )
    response = client.post(
        f"/api/v1/workspaces/{project}/cropping/{route}", json=request.model_dump(mode="json")
    )
    assert response.status_code == 200, response.text
    return CropPlan.model_validate(response.json())


def test_multiple_sources_are_one_operation_with_atomic_undo(studio: StudioSession) -> None:
    client, project, root = studio
    hashes = {p: file_sha256(p) for p in root.rglob("*") if p.suffix in {".png", ".txt", ".json"}}
    plan = preview(studio, request_for(studio))
    assert plan.total == 4
    response = execute(client, project, plan)
    assert response.status_code == 200, response.text
    operation = response.json()
    history = client.get(f"/api/v1/workspaces/{project}/cropping/operations").json()
    assert len(history) == 1 and history[0]["total"] == 4
    assert operation["status"] == "succeeded"
    assert all(file_sha256(path) == value for path, value in hashes.items())
    outputs = [
        asset for asset in assets(client, project) if asset.relative_path.startswith("cropped/")
    ]
    assert len(outputs) == 4
    assert all(not asset.annotation_channels for asset in outputs)
    undo = client.post(f"/api/v1/workspaces/{project}/cropping/operations/{operation['id']}/undo")
    assert undo.status_code == 200, undo.text
    assert not list((root / "cropped").rglob("*.png"))
    assert all(file_sha256(path) == value for path, value in hashes.items())


def test_positioned_batch_uses_explicit_pixels_and_retains_maximum_dimensions(
    studio: StudioSession,
) -> None:
    client, project, root = studio
    image = Image.new("RGB", (101, 61))
    image.putdata([(x * 2, y * 4, (x + y) % 256) for y in range(61) for x in range(101)])
    image.save(root / "a.png")
    response = client.post(f"/api/v1/workspaces/{project}/scan")
    assert response.status_code == 200, response.text
    source = next(item for item in assets(client, project) if item.filename == "a.png")
    ratio = Ratio(width=1, height=1)
    centered = centered_rectangle(source.width, source.height, ratio)
    moved = centered.model_copy(update={"x": 0})
    request = PositionedBatchCropRequest(
        ratio=ratio,
        items=[
            CropSourceRegions(
                asset_id=source.id,
                source_version=source.content_version,
                rectangles=[moved],
            )
        ],
    )
    plan = preview(studio, request)
    assert plan.items[0].rectangle == moved
    response = execute(client, project, plan)
    assert response.status_code == 200, response.text
    with Image.open(root / plan.items[0].output_path) as output:
        assert output.tobytes() == image.crop((0, 0, 61, 61)).tobytes()
        assert output.tobytes() != image.crop((20, 0, 81, 61)).tobytes()
    assert file_sha256(root / "a.png") == source.content_version
    second = preview(studio, request)
    assert second.items[0].output_path != plan.items[0].output_path


@pytest.mark.parametrize(
    "change", ["size", "ratio", "boundary", "version", "duplicate", "multiple"]
)
def test_positioned_batch_rejects_invalid_or_stale_edits(
    studio: StudioSession, change: str
) -> None:
    client, project, _ = studio
    source = assets(client, project)[0]
    ratio = Ratio(width=1, height=1)
    rect = centered_rectangle(source.width, source.height, ratio)
    item = CropSourceRegions(
        asset_id=source.id, source_version=source.content_version, rectangles=[rect]
    )
    payload = PositionedBatchCropRequest(ratio=ratio, items=[item]).model_dump(mode="json")
    if change == "size":
        payload["items"][0]["rectangles"][0].update(width=20, height=20)
    elif change == "ratio":
        payload["items"][0]["rectangles"][0]["ratio"] = {"width": 2, "height": 3}
    elif change == "boundary":
        payload["items"][0]["rectangles"][0]["x"] = source.width
    elif change == "version":
        payload["items"][0]["source_version"] = "stale-source"
    elif change == "duplicate":
        payload["items"].append(payload["items"][0])
    else:
        payload["items"][0]["rectangles"].append(rect.model_dump(mode="json"))
    response = client.post(
        f"/api/v1/workspaces/{project}/cropping/positioned-preview", json=payload
    )
    assert response.status_code in {400, 422}, response.text
    assert client.get(f"/api/v1/workspaces/{project}/cropping/operations").json() == []


def test_multisource_failure_rolls_back_entire_batch(studio: StudioSession) -> None:
    client, project, root = studio
    request = request_for(studio)
    plan = preview(studio, request)
    paths, _ = client.app.state.container.workspaces.get(project)
    with transaction(paths.database) as connection:
        connection.execute("""CREATE TRIGGER reject_second_source BEFORE INSERT ON assets
            WHEN NEW.relative_path LIKE 'cropped/nested/%'
            BEGIN SELECT RAISE(ABORT, 'multi-source transaction failure'); END""")
    response = execute(client, project, plan)
    assert response.status_code == 500 and "multi-source transaction failure" in response.text
    assert len(assets(client, project)) == 2
    assert not list((root / "cropped").rglob("*.png"))
    with closing(connect(paths.database)) as connection:
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM crop_outputs WHERE phase != 'rolled_back'"
            ).fetchone()[0]
            == 0
        )
    for item in request.items:
        source = next(asset for asset in assets(client, project) if asset.id == item.asset_id)
        assert file_sha256(root / source.relative_path) == item.source_version


def test_source_selection_is_explicit_and_batch_excludes_generated(studio: StudioSession) -> None:
    client, project, _ = studio
    prefix = f"/api/v1/workspaces/{project}/cropping"
    ids = [item.id for item in assets(client, project)]
    response = client.post(f"{prefix}/source-selection", json={"asset_ids": ids})
    assert response.status_code == 200 and [row["id"] for row in response.json()] == ids
    for invalid in [[], [ids[0], ids[0]]]:
        assert (
            client.post(f"{prefix}/source-selection", json={"asset_ids": invalid}).status_code
            == 422
        )
    scope = {
        "scope": "selected",
        "asset_ids": [],
        "filters": {"search": "", "status": None, "folder_path": ""},
    }
    assert client.post(f"{prefix}/source-scope", json=scope).status_code == 422
    assert execute(client, project, preview(studio, request_for(studio))).status_code == 200
    scope.update(scope="all")
    response = client.post(f"{prefix}/source-scope", json=scope)
    assert response.status_code == 200 and {row["id"] for row in response.json()} == set(ids)
