"""Real unavailable-workspace coverage for audit startup, polling, and shutdown APIs."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from dataset_studio.api.app import create_app
from dataset_studio.modules.character_audits import repository, service
from dataset_studio.modules.character_audits.worker import run_character_audits
from test_character_audits import audit_context, request_for, stage_review


@pytest.mark.parametrize(
    ("filename", "contents"),
    [
        ("project.json", None),
        ("project.json", b"invalid json"),
        ("state.sqlite3", b"invalid sqlite"),
    ],
)
def test_unavailable_recent_workspace_does_not_break_worker_or_audit_queries(
    tmp_path: Path, caplog: pytest.LogCaptureFixture, filename: str, contents: bytes | None
) -> None:
    with audit_context(tmp_path) as (context, project_id, ids, provider, vocabulary):
        operation = service.create(context, project_id, request_for(ids, provider, vocabulary, 1))
        service.start(context, project_id, operation.id, operation.version)
        missing_root = tmp_path / "unavailable"
        missing_root.mkdir()
        missing, _ = context.workspaces.open(str(missing_root))
        paths, _ = context.workspaces.get(missing.project_id)
        context.workspaces.mark_worker_activity(missing.project_id, "character_audits")
        damaged = paths.manifest if filename == "project.json" else paths.database
        if contents is None:
            damaged.unlink()
        else:
            damaged.write_bytes(contents)
        stopped = asyncio.Event()
        stopped.set()
        with caplog.at_level(logging.WARNING, logger="dataset_studio.character_audits"):
            asyncio.run(run_character_audits(context, stopped))
        assert [
            item.project_id for item in context.workspaces.worker_candidates("character_audits")
        ] == [project_id]
        records = [
            record
            for record in caplog.records
            if getattr(record, "project_id", None) == missing.project_id
        ]
        assert records and all(getattr(record, "error", "") for record in records)
        assert service.active_count(context.workspaces) == 1
        assert service.active_project_ids(context.workspaces) == {project_id}
        assert service.stop_all(context) == 1
        assert service.active_count(context.workspaces) == 0
        if contents is None:
            assert not damaged.exists()
        else:
            assert damaged.read_bytes() == contents


def test_workspace_removed_after_startup_does_not_block_healthy_audit(tmp_path: Path) -> None:
    with audit_context(tmp_path) as (context, project_id, ids, provider, vocabulary):
        operation = service.create(context, project_id, request_for(ids, provider, vocabulary, 1))
        completed = stage_review(
            context, project_id, service.start(context, project_id, operation.id, operation.version)
        )
        healthy_paths, _ = context.workspaces.get(project_id)
        other_root = tmp_path / "removed-after-startup"
        other_root.mkdir()
        missing, _ = context.workspaces.open(str(other_root))
        missing_paths, _ = context.workspaces.get(missing.project_id)

        async def run() -> None:
            stopped = asyncio.Event()
            task = asyncio.create_task(run_character_audits(context, stopped))
            try:
                await asyncio.sleep(0)
                assert not task.done()
                missing_paths.manifest.unlink()
                context.workspaces.mark_worker_activity(missing.project_id, "character_audits")
                repository.save_operation(
                    healthy_paths.database, completed.model_copy(update={"status": "queued"})
                )
                context.workspaces.mark_worker_activity(project_id, "character_audits")
                async with asyncio.timeout(5):
                    while True:
                        if task.done():
                            task.result()
                            pytest.fail("Audit worker exited before shutdown")
                        current = repository.get_operation(healthy_paths.database, operation.id)
                        if current.status == "review":
                            break
                        await asyncio.sleep(0.02)
                assert current.reviews[0].decisions == completed.reviews[0].decisions
                assert current.reviews[0].confirmed
                assert not current.attempts
                assert missing.project_id not in {
                    item.project_id
                    for item in context.workspaces.worker_candidates("character_audits")
                }
            finally:
                stopped.set()
                await asyncio.wait_for(task, timeout=5)

        asyncio.run(run())


def test_exit_api_works_with_missing_recent_project_manifest(tmp_path: Path) -> None:
    with audit_context(tmp_path) as (context, project_id, ids, provider, vocabulary):
        operation = service.create(context, project_id, request_for(ids, provider, vocabulary, 1))
        service.start(context, project_id, operation.id, operation.version)
        missing_root = tmp_path / "unavailable"
        missing_root.mkdir()
        missing, _ = context.workspaces.open(str(missing_root))
        paths, _ = context.workspaces.get(missing.project_id)
        paths.manifest.unlink()
        with TestClient(create_app(context.settings)) as client:
            active = client.get("/api/v1/jobs/active")
            assert active.status_code == 200, active.text
            assert active.json()["character_audit_count"] == 1
            stopped = client.post("/api/v1/jobs/stop-all")
            assert stopped.status_code == 200, stopped.text
            assert stopped.json()["stopped"] == 1
            assert client.get("/api/v1/jobs/active").json()["character_audit_count"] == 0
        assert not paths.manifest.exists()
