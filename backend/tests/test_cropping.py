from collections.abc import Iterator
from pathlib import Path
from typing import Literal, NamedTuple

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from PIL import Image

from dataset_studio.api.app import create_app
from dataset_studio.core.config import Settings
from dataset_studio.core.files import file_sha256
from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.modules.assets.models import AssetListResponse, AssetSummary
from dataset_studio.modules.cropping.geometry import centered_rectangle
from dataset_studio.modules.cropping.models import CropPlan, CropRect, Ratio, SingleCropRequest
from dataset_studio.modules.cropping.presets import list_presets
from dataset_studio.modules.workspaces.models import WorkspaceOpenResponse


class StudioSession(NamedTuple):
    client: TestClient
    project: str
    root: Path


@pytest.fixture
def studio(tmp_path: Path) -> Iterator[StudioSession]:
    root = tmp_path / "dataset"
    root.mkdir()
    Image.new("RGBA", (101, 61), (20, 80, 140, 110)).save(root / "a.png")
    (root / "a.txt").write_text("original annotation", encoding="utf-8")
    (root / "a.json").write_text('{"original":true}', encoding="utf-8")
    (root / "nested").mkdir()
    Image.new("RGB", (63, 97), "blue").save(root / "nested" / "b.png")
    settings = Settings(app_data_dir=tmp_path / "app", host="127.0.0.1", port=0)
    with TestClient(create_app(settings)) as client:
        opened = client.post("/api/v1/workspaces/open", json={"path": str(root)})
        assert opened.status_code == 200, opened.text
        project = WorkspaceOpenResponse.model_validate(opened.json()).workspace.project_id
        yield StudioSession(client, project, root)


def assets(client: TestClient, project: str) -> list[AssetSummary]:
    response = client.get(f"/api/v1/workspaces/{project}/assets", params={"candidate_scope": "all"})
    assert response.status_code == 200, response.text
    return AssetListResponse.model_validate(response.json()).items


def single(client: TestClient, project: str, asset_id: str, rectangles: list[CropRect]) -> CropPlan:
    response = client.post(
        f"/api/v1/workspaces/{project}/cropping/single-preview",
        json=SingleCropRequest(asset_id=asset_id, rectangles=rectangles).model_dump(mode="json"),
    )
    assert response.status_code == 200, response.text
    return CropPlan.model_validate(response.json())


def execute(client: TestClient, project: str, plan: CropPlan) -> Response:
    return client.post(
        f"/api/v1/workspaces/{project}/cropping/execute",
        json={"plan_id": plan.id, "token": plan.token},
    )


def batch(
    client: TestClient,
    project: str,
    scope: Literal["all", "selected", "folder", "filtered"],
    ids: list[str],
    folder: str,
) -> Response:
    return client.post(
        f"/api/v1/workspaces/{project}/cropping/batch-preview",
        json={
            "scope": scope,
            "asset_ids": ids,
            "filters": {"search": "", "status": None, "folder_path": folder},
            "ratio": {"width": 16, "height": 9},
        },
    )


def test_multiple_outputs_preserve_source_annotation_and_identity(studio: StudioSession) -> None:
    client, project, root = studio
    original = {p.name: p.read_bytes() for p in root.glob("a.*")}
    source = next(a for a in assets(client, project) if a.filename == "a.png")
    rects = [
        CropRect(x=0, y=0, width=50, height=50, ratio=None),
        CropRect(x=31, y=21, width=70, height=40, ratio=None),
    ]
    plan = single(client, project, source.id, rects)
    preview = client.get(f"/api/v1/workspaces/{project}/cropping/plans/{plan.id}/items/0/result")
    assert preview.status_code == 200 and preview.headers["content-type"] == "image/png"
    response = execute(client, project, plan)
    assert response.status_code == 200, response.text
    assert response.json()["completed"] == 2
    generated = [a for a in assets(client, project) if a.relative_path.startswith("cropped/")]
    assert len(generated) == 2
    assert len({a.id for a in [*generated, source]}) == 3
    assert all(a.annotation_status == "missing" for a in generated)
    assert {p.name: p.read_bytes() for p in root.glob("a.*")} == original
    for item in plan.items:
        provenance = client.get(f"/api/v1/workspaces/{project}/cropping/sources/{item.output_id}")
        assert provenance.status_code == 200
        assert provenance.json()["item"]["source_id"] == source.id
        with Image.open(root / item.output_path) as image:
            assert image.format == "PNG" and image.mode == "RGBA"
            assert image.size == (item.rectangle.width, item.rectangle.height)
            assert image.getpixel((0, 0))[3] == 110
    paths, _ = client.app.state.container.workspaces.get(project)
    with connect(paths.database) as connection:
        rows = connection.execute("SELECT * FROM crop_outputs").fetchall()
        assert all(row["source_id"] == source.id for row in rows)
        assert all(row["source_hash"] == file_sha256(root / "a.png") for row in rows)
    assert execute(client, project, plan).status_code == 400
    operation_id = response.json()["id"]
    undone = client.post(f"/api/v1/workspaces/{project}/cropping/operations/{operation_id}/undo")
    assert undone.status_code == 200, undone.text
    assert not list((root / "cropped").glob("*.png"))
    assert {p.name: p.read_bytes() for p in root.glob("a.*")} == original


def test_batch_ranges_exclude_outputs_and_empty_selection(studio: StudioSession) -> None:
    client, project, _ = studio
    original = assets(client, project)
    assert batch(client, project, "selected", [], "").status_code == 422
    response = batch(client, project, "all", [], "")
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 2
    assert execute(client, project, CropPlan.model_validate(response.json())).status_code == 200
    assert batch(client, project, "all", [], "").json()["total"] == 2
    assert batch(client, project, "folder", [], "nested").json()["total"] == 1
    chosen = batch(client, project, "selected", [original[0].id], "")
    assert chosen.json()["total"] == 1
    filtered = client.post(
        f"/api/v1/workspaces/{project}/cropping/batch-preview",
        json={
            "scope": "filtered",
            "asset_ids": [],
            "filters": {"search": "b.png", "status": None, "folder_path": ""},
            "ratio": {"width": 2.35, "height": 1},
        },
    )
    assert filtered.status_code == 200 and filtered.json()["total"] == 1
    scope = client.patch(
        f"/api/v1/workspaces/{project}/assets/candidates",
        json={"action": "add", "asset_ids": [original[0].id]},
    )
    assert scope.status_code == 200, scope.text
    assert batch(client, project, "all", [], "").json()["total"] == 1
    assert batch(client, project, "selected", [original[1].id], "").status_code == 400


def test_presets_persist_and_builtins_are_readonly(studio: StudioSession) -> None:
    client, _, _ = studio
    response = client.post(
        "/api/v1/crop-ratio-presets", json={"name": "cinema", "ratio": {"width": 2.35, "height": 1}}
    )
    assert response.status_code == 200, response.text
    preset_id = response.json()["id"]
    updated = client.put(
        f"/api/v1/crop-ratio-presets/{preset_id}",
        json={"name": "portrait", "ratio": {"width": 7, "height": 5}},
    )
    assert updated.status_code == 200
    database = client.app.state.container.settings.app_data_dir / "global.sqlite3"
    assert next(p for p in list_presets(database) if p.id == preset_id).ratio == Ratio(
        width=7, height=5
    )
    assert client.delete("/api/v1/crop-ratio-presets/builtin-1-1").status_code == 400
    assert client.delete(f"/api/v1/crop-ratio-presets/{preset_id}").status_code == 204
    assert len(client.get("/api/v1/crop-ratio-presets").json()) == 7
    assert (
        client.post(
            "/api/v1/crop-ratio-presets", json={"name": "bad", "ratio": {"width": 0, "height": 1}}
        ).status_code
        == 422
    )


def test_source_change_and_target_collision_invalidate_preview(studio: StudioSession) -> None:
    client, project, root = studio
    source = assets(client, project)[0]
    rect = CropRect(x=0, y=0, width=30, height=30, ratio=None)
    plan = single(client, project, source.id, [rect])
    output = root / plan.items[0].output_path
    output.parent.mkdir(parents=True)
    output.write_bytes(b"user file")
    response = execute(client, project, plan)
    assert response.status_code == 400 and "预览已失效" in response.text
    assert output.read_bytes() == b"user file"
    plan = single(client, project, source.id, [rect])
    Image.new("RGBA", (101, 61), "red").save(root / "a.png")
    assert execute(client, project, plan).status_code == 400


def test_integer_geometry_odd_dimensions_and_tiny_ratio() -> None:
    assert centered_rectangle(5, 4, Ratio(width=2, height=1)).height == 3
    for width, height in ((101, 61), (61, 101), (1, 1), (2001, 1000)):
        for ratio in (
            Ratio(width=16, height=9),
            Ratio(width=2.35, height=1),
            Ratio(width=7, height=5),
        ):
            rect = centered_rectangle(width, height, ratio)
            assert rect.x >= 0 and rect.x + rect.width <= width
            assert rect.y >= 0 and rect.y + rect.height <= height
    assert centered_rectangle(1, 1, Ratio(width=1_000_000, height=0.001)).width == 1


def test_sqlite_failure_rolls_back_all_new_files(studio: StudioSession) -> None:
    client, project, root = studio
    plan = CropPlan.model_validate(batch(client, project, "all", [], "").json())
    paths, _ = client.app.state.container.workspaces.get(project)
    with transaction(paths.database) as connection:
        connection.execute("""CREATE TRIGGER reject_second_crop BEFORE INSERT ON assets
            WHEN NEW.relative_path LIKE 'cropped/nested/%'
            BEGIN SELECT RAISE(ABORT, 'intentional SQLite integration failure'); END""")
    failed = execute(client, project, plan)
    assert failed.status_code == 500 and "intentional SQLite integration failure" in failed.text
    assert not list((root / "cropped").rglob("*.png"))
    assert len(assets(client, project)) == 2
    history = client.get(f"/api/v1/workspaces/{project}/cropping/operations").json()
    assert history[0]["status"] == "failed"


def test_undo_rejects_file_changes_and_newer_preprocessing(studio: StudioSession) -> None:
    client, project, root = studio
    plan = CropPlan.model_validate(batch(client, project, "all", [], "").json())
    result = execute(client, project, plan).json()
    output = root / plan.items[0].output_path
    original = output.read_bytes()
    output.write_bytes(b"changed")
    url = f"/api/v1/workspaces/{project}/cropping/operations/{result['id']}/undo"
    assert client.post(url).status_code == 400
    output.write_bytes(original)
    paths, _ = client.app.state.container.workspaces.get(project)
    with transaction(paths.database) as connection:
        connection.execute(
            "INSERT INTO preprocess_operations(id,status,options_json,created_at) "
            "VALUES('newer','completed','{}','2999')"
        )
    assert client.post(url).status_code == 400
    assert output.exists()


def test_whole_image_still_creates_independent_material(studio: StudioSession) -> None:
    client, project, root = studio
    source = next(a for a in assets(client, project) if a.filename == "a.png")
    plan = single(
        client, project, source.id, [CropRect(x=0, y=0, width=101, height=61, ratio=None)]
    )
    assert plan.items[0].whole_image
    assert execute(client, project, plan).status_code == 200
    client.post(f"/api/v1/workspaces/{project}/scan")
    assert len(assets(client, project)) == 3
    assert len({item.id for item in assets(client, project)}) == 3
    assert (root / "a.png").exists()
