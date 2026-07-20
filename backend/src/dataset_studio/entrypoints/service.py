from __future__ import annotations

import asyncio
import logging
from logging.handlers import RotatingFileHandler

import uvicorn

from dataset_studio.api.app import create_app
from dataset_studio.api.container import AppContainer
from dataset_studio.core.config import settings
from dataset_studio.modules.exports.worker import ExportWorker
from dataset_studio.modules.jobs.worker import AnnotationWorker


async def run_service() -> None:
    stopped = asyncio.Event()
    worker_container = AppContainer.create(settings)
    annotation_worker = AnnotationWorker(worker_container)
    export_worker = ExportWorker(worker_container)
    worker_tasks = (
        asyncio.create_task(annotation_worker.run(stopped)),
        asyncio.create_task(export_worker.run(stopped)),
    )
    server = uvicorn.Server(
        uvicorn.Config(
            create_app(settings),
            host=settings.host,
            port=settings.port,
            log_config=None,
            access_log=False,
        )
    )
    try:
        await server.serve()
    finally:
        stopped.set()
        try:
            await asyncio.gather(*worker_tasks, return_exceptions=True)
        finally:
            await worker_container.aclose()


def configure_logging() -> None:
    settings.ensure_directories()
    log_directory = settings.app_data_dir / "logs"
    log_directory.mkdir(exist_ok=True)
    handler = RotatingFileHandler(
        log_directory / "service.log",
        maxBytes=2 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8",
    )
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logging.basicConfig(level=logging.INFO, handlers=[handler])


def main() -> None:
    configure_logging()
    asyncio.run(run_service())


if __name__ == "__main__":
    main()
