"""Isolated real API and image dataset for Legacy cropping integration tests."""

from __future__ import annotations

import json
import socket
import tempfile
from pathlib import Path

import uvicorn
from PIL import Image

from dataset_studio.api.app import create_app
from dataset_studio.core.config import Settings
from dataset_studio.modules.workspaces.repository import WorkspaceRegistry
from dataset_studio.modules.workspaces.service import WorkspaceService
from dataset_studio.platform.global_store import initialize_global_database


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="cropping-ui-") as temporary:
        root = Path(temporary)
        source = root / "dataset"
        source.mkdir()
        Image.new("RGBA", (301, 201), (180, 40, 20, 160)).save(source / "original.png")
        (source / "original.txt").write_text("original annotation", encoding="utf-8")
        (source / "folder").mkdir()
        Image.new("RGB", (101, 201), "blue").save(source / "folder" / "second.png")
        settings = Settings(
            app_data_dir=root / "app",
            host="127.0.0.1",
            port=0,
            frontend_port=Settings.from_environment().frontend_port,
        )
        settings.ensure_directories()
        database = settings.app_data_dir / "global.sqlite3"
        initialize_global_database(database)
        workspaces = WorkspaceService(settings, WorkspaceRegistry(database))
        summary, _ = workspaces.open(str(source))
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            sock.listen(128)
            print(
                "CROPPING_UI "
                + json.dumps(
                    {
                        "base_url": f"http://127.0.0.1:{sock.getsockname()[1]}",
                        "project_id": summary.project_id,
                        "source_directory": str(source),
                    }
                ),
                flush=True,
            )
            uvicorn.Server(uvicorn.Config(create_app(settings), log_level="error")).run(
                sockets=[sock]
            )


if __name__ == "__main__":
    main()
