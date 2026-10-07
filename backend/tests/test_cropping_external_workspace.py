import errno
import os
from contextlib import closing
from pathlib import Path

import pytest

from dataset_studio.core.files import atomic_copy_file
from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.modules.cropping import files, planner
from dataset_studio.modules.cropping.execution import recover_orphaned
from dataset_studio.modules.cropping.models import CropRect
from dataset_studio.modules.cropping.storage import output_rows
from test_cropping import StudioSession, assets, execute, single, studio

__all__ = ["studio"]


@pytest.fixture
def local_links_only(monkeypatch: pytest.MonkeyPatch) -> list[tuple[Path, Path]]:
    """Model separate volumes: only publication beside its destination may link."""
    real_link = os.link
    calls: list[tuple[Path, Path]] = []

    def link(source: Path, target: Path) -> None:
        source, target = Path(source), Path(target)
        if source.parent != target.parent:
            raise OSError(errno.EXDEV, "test: cross-volume link")
        calls.append((source, target))
        real_link(source, target)

    monkeypatch.setattr(files.os, "link", link)
    return calls


def test_external_recovery_supports_crop_undo_and_interrupted_undo(
    studio: StudioSession, local_links_only: list[tuple[Path, Path]]
) -> None:
    client, project, root = studio
    source = assets(client, project)[0]
    original = (root / source.relative_path).read_bytes()
    plan = single(client, project, source.id, [CropRect(x=0, y=0, width=10, height=10, ratio=None)])
    result = execute(client, project, plan)
    assert result.status_code == 200, result.text
    operation_id = result.json()["id"]
    paths, _ = client.app.state.container.workspaces.get(project)
    assert not paths.internal.is_relative_to(root)
    output = root / plan.items[0].output_path
    backup = paths.recovery / operation_id / "crop-undo"
    backup.mkdir()
    saved = backup / f"{plan.items[0].output_id}.png"
    atomic_copy_file(output, saved)
    # Recovery also handles a crash after copying but before removing the output.
    with transaction(paths.database) as connection:
        connection.execute(
            "UPDATE crop_operations SET status='undoing' WHERE id=?", (operation_id,)
        )
        connection.execute(
            "UPDATE preprocess_operations SET status='recovering' WHERE id=?", (operation_id,)
        )
    assert recover_orphaned(client.app.state.container.workspaces) == 1
    assert output.is_file() and not backup.exists()

    backup.mkdir()
    atomic_copy_file(output, saved)
    output.unlink()
    # Simulate another interruption while restoring the cross-volume backup:
    # the target-local staging file and its identity are durable, but not published.
    staged = files.staging_path(paths, plan.items[0].output_id, plan.items[0].output_path)
    atomic_copy_file(saved, staged)
    files.remember_identity(paths.database, plan.items[0].output_id, staged.stat())
    with transaction(paths.database) as connection:
        connection.execute(
            "UPDATE crop_operations SET status='undoing' WHERE id=?", (operation_id,)
        )
        connection.execute(
            "UPDATE preprocess_operations SET status='recovering' WHERE id=?", (operation_id,)
        )
    assert recover_orphaned(client.app.state.container.workspaces) == 1
    assert output.is_file()
    assert not staged.exists()
    undone = client.post(f"/api/v1/workspaces/{project}/cropping/operations/{operation_id}/undo")
    assert undone.status_code == 200, undone.text
    assert not output.exists()
    assert (root / source.relative_path).read_bytes() == original
    assert len(local_links_only) == 2
    assert not list(root.rglob(".dataset-studio-crop-*.tmp"))


def test_rollback_uses_journaled_identity_after_local_staging_is_removed(
    studio: StudioSession, local_links_only: list[tuple[Path, Path]]
) -> None:
    client, project, root = studio
    source = assets(client, project)[0]
    plan = single(client, project, source.id, [CropRect(x=0, y=0, width=10, height=10, ratio=None)])
    paths, _ = client.app.state.container.workspaces.get(project)
    with transaction(paths.database) as connection:
        connection.execute("""CREATE TRIGGER reject_crop BEFORE INSERT ON assets
            WHEN NEW.relative_path LIKE 'cropped/%'
            BEGIN SELECT RAISE(ABORT, 'reject published crop'); END""")
    result = execute(client, project, plan)
    assert result.status_code == 500 and "reject published crop" in result.text
    assert not list((root / "cropped").rglob("*.png"))
    assert not list(root.rglob(".dataset-studio-crop-*.tmp"))
    assert len(local_links_only) == 1
    with closing(connect(paths.database)) as connection:
        assert connection.execute("SELECT status FROM crop_operations").fetchone()[0] == "failed"
        assert connection.execute("SELECT phase FROM crop_outputs").fetchone()[0] == "rolled_back"


def test_recovery_does_not_delete_an_unrelated_identical_replacement(studio: StudioSession) -> None:
    client, project, root = studio
    source = assets(client, project)[0]
    plan = single(client, project, source.id, [CropRect(x=0, y=0, width=10, height=10, ratio=None)])
    result = execute(client, project, plan).json()
    paths, _ = client.app.state.container.workspaces.get(project)
    output = root / plan.items[0].output_path
    replacement = output.with_suffix(".replacement")
    replacement.write_bytes(output.read_bytes())
    replacement.replace(output)
    with transaction(paths.database) as connection:
        connection.execute(
            "UPDATE crop_operations SET status='running' WHERE id=?", (result["id"],)
        )
        connection.execute(
            "UPDATE preprocess_operations SET status='running' WHERE id=?", (result["id"],)
        )
    assert recover_orphaned(client.app.state.container.workspaces) == 0
    assert output.is_file()
    assert not files.owns_file(output, output_rows(paths.database, result["id"])[0])


def test_allocating_many_rectangles_does_not_reprobe_reserved_names(
    studio: StudioSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, project, _ = studio
    source = assets(client, project)[0]
    original = planner.safe_path
    checked_paths: list[str] = []

    def checked(root: Path, relative: str) -> Path:
        checked_paths.append(relative)
        return original(root, relative)

    monkeypatch.setattr(planner, "safe_path", checked)
    count = 64
    plan = single(
        client,
        project,
        source.id,
        [CropRect(x=0, y=0, width=10, height=10, ratio=None)] * count,
    )
    assert plan.total == count
    assert len(checked_paths) <= count + 1
    assert len(set(checked_paths)) == len(checked_paths)
