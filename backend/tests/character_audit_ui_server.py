"""Isolated real API server for UI integration; no provider responses are mocked.

The saved review is a manually seeded domain fixture. Model inference is deliberately
not run here; exercising that boundary requires an explicitly selected live connection.
"""

from __future__ import annotations

import json
import socket
import tempfile
from dataclasses import replace
from pathlib import Path

import uvicorn

from dataset_studio.api.app import create_app
from dataset_studio.core.config import Settings
from dataset_studio.modules.character_audits import repository, service
from dataset_studio.modules.character_audits.models import ReviewUpdate
from test_character_audits import audit_context, request_for, stage_review


def main() -> None:
    with (
        tempfile.TemporaryDirectory(prefix="character-audit-ui-") as temporary,
        audit_context(Path(temporary)) as (context, project_id, ids, provider, vocabulary),
    ):
        request = request_for(ids, provider, vocabulary, 2)
        draft = service.create(context, project_id, request)
        review = service.create(context, project_id, request)
        review = stage_review(
            context, project_id, service.start(context, project_id, review.id, review.version)
        )
        decisions = [
            item.model_copy(update={"decision": "keep", "replacement": None})
            for item in review.reviews[1].decisions
        ]
        review = service.save_review(
            context,
            project_id,
            review.id,
            1,
            ReviewUpdate(version=review.version, decisions=decisions),
        )
        paths, _ = context.workspaces.get(project_id)
        repository.save_operation(
            paths.database,
            review.model_copy(
                update={
                    "reviews": [
                        item.model_copy(update={"confirmed": False}) for item in review.reviews
                    ],
                }
            ),
        )
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            sock.listen(128)
            port = sock.getsockname()[1]
            print(
                "CHARACTER_AUDIT_UI "
                + json.dumps(
                    {
                        "base_url": f"http://127.0.0.1:{port}",
                        "project_id": project_id,
                        "review_id": review.id,
                        "draft_id": draft.id,
                        "provider_id": provider,
                        "reference_id": ids[0],
                        "vocabulary_id": vocabulary,
                        "source_directory": str(Path(temporary) / "source"),
                    }
                ),
                flush=True,
            )
            settings = replace(
                context.settings, frontend_port=Settings.from_environment().frontend_port
            )
            server = uvicorn.Server(uvicorn.Config(create_app(settings), log_level="error"))
            server.run(sockets=[sock])


if __name__ == "__main__":
    main()
