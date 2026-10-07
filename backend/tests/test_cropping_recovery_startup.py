from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from dataset_studio.api.app import create_app
from dataset_studio.core.config import Settings
from dataset_studio.core.files import file_sha256
from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.modules.cropping.models import CropRect
from dataset_studio.modules.workspaces.models import WorkspaceOpenResponse
from test_cropping import assets, execute, single


def open_project(client: TestClient, root: Path) -> str:
    root.mkdir(exist_ok=True)
    Image.new("RGB", (60, 40), "green").save(root / "source.png")
    response = client.post("/api/v1/workspaces/open", json={"path": str(root)})
    assert response.status_code == 200, response.text
    return WorkspaceOpenResponse.model_validate(response.json()).workspace.project_id


@pytest.mark.parametrize("damage", ["modified", "missing", "undo_conflict"])
def test_recovery_failure_is_visible_and_only_blocks_its_project(
    tmp_path: Path, damage: str, caplog: pytest.LogCaptureFixture
) -> None:
    settings = Settings(app_data_dir=tmp_path / "app", host="127.0.0.1", port=0)
    root = tmp_path / "damaged"
    with TestClient(create_app(settings)) as client:
        project = open_project(client, root)
        source = assets(client, project)[0]
        source_hash = file_sha256(root / "source.png")
        plan = single(
            client, project, source.id, [CropRect(x=2, y=3, width=20, height=10, ratio=None)]
        )
        result = execute(client, project, plan)
        assert result.status_code == 200, result.text
        operation = result.json()["id"]
        paths, _ = client.app.state.container.workspaces.get(project)
        output = root / plan.items[0].output_path
        if damage == "missing":
            output.unlink()
        elif damage == "modified":
            output.write_bytes(b"user modification")
        else:
            backup = paths.recovery / operation / "crop-undo"
            backup.mkdir()
            output.rename(backup / f"{plan.items[0].output_id}.png")
            output.write_bytes(b"unrelated replacement")
        changed_output = output.read_bytes() if output.exists() else None
        with transaction(paths.database) as connection:
            connection.execute(
                "UPDATE crop_operations SET status=? WHERE id=?",
                ("undoing" if damage == "undo_conflict" else "running", operation),
            )
            connection.execute(
                "UPDATE preprocess_operations SET status='recovering' WHERE id=?",
                (operation,),
            )
        healthy = open_project(client, tmp_path / "healthy")
        healthy_source = assets(client, healthy)[0]

    # Repeated startup must expose the same failure without blocking health or other projects.
    for _ in range(2):
        with TestClient(create_app(settings)) as client:
            assert client.get("/health").status_code == 200
            operations = client.get(f"/api/v1/workspaces/{project}/cropping/operations")
            assert operations.status_code == 200
            failed = operations.json()[0]
            assert failed["id"] == operation
            assert failed["status"] == (
                "undoing" if damage == "undo_conflict" else "recovery_failed"
            )
            assert "恢复失败" in failed["error"]
            assert operation in failed["error"]
            blocked = client.post(f"/api/v1/workspaces/{project}/scan")
            assert blocked.status_code == 400 and operation in blocked.text
            assert client.get(f"/api/v1/workspaces/{project}/assets").status_code == 200
            assert file_sha256(root / "source.png") == source_hash
            assert (output.read_bytes() if output.exists() else None) == changed_output
            # The ordinary preprocessing recovery must not claim the crop's durable guard row.
            client.app.state.container.preprocessing.recover_orphaned()
            with connect(paths.database) as connection:
                row = connection.execute(
                    "SELECT status FROM preprocess_operations WHERE id=?", (operation,)
                ).fetchone()
                assert row["status"] == "recovering"
            healthy_plan = single(
                client,
                healthy,
                healthy_source.id,
                [CropRect(x=0, y=0, width=8, height=8, ratio=None)],
            )
            assert execute(client, healthy, healthy_plan).status_code == 200
    assert any(
        record.message == "Crop recovery requires intervention"
        and record.project_id == project
        and record.operation_id == operation
        for record in caplog.records
        if record.name == "dataset_studio.modules.cropping.execution"
    )
