from dataset_studio.modules.cropping.models import CropRect
from test_cropping import StudioSession, assets, execute, single, studio

__all__ = ["studio"]


def test_source_lookup_preserves_identity_beyond_first_page_and_respects_scope(
    studio: StudioSession,
) -> None:
    client, project, _ = studio
    source = next(item for item in assets(client, project) if item.filename == "b.png")
    plan = single(
        client, project, source.id, [CropRect(x=0, y=0, width=10, height=10, ratio=None)] * 501
    )
    result = execute(client, project, plan)
    assert result.status_code == 200, result.text
    first = client.get(f"/api/v1/workspaces/{project}/assets", params={"limit": 500}).json()[
        "items"
    ]
    assert len(first) == 500 and source.id not in {item["id"] for item in first}
    url = f"/api/v1/workspaces/{project}/assets/{source.id}/lookup"
    query = {"search": "", "status": None, "folder_path": "", "candidate_scope": "auto"}
    selected = client.post(url, json=query)
    assert selected.status_code == 200 and selected.json()["id"] == source.id
    outside = client.post(url, json={**query, "search": "a.png"})
    assert outside.status_code == 200 and outside.json() is None


def test_missing_prior_output_does_not_reuse_its_persisted_asset_identity(
    studio: StudioSession,
) -> None:
    client, project, root = studio
    source = next(item for item in assets(client, project) if item.filename == "a.png")
    rect = CropRect(x=0, y=0, width=10, height=10, ratio=None)
    first = single(client, project, source.id, [rect])
    assert execute(client, project, first).status_code == 200
    (root / first.items[0].output_path).unlink()
    assert client.post(f"/api/v1/workspaces/{project}/scan").status_code == 200
    second = single(client, project, source.id, [rect])
    assert second.items[0].output_path != first.items[0].output_path
    assert second.items[0].output_id != first.items[0].output_id
    assert execute(client, project, second).status_code == 200
