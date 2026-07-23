from __future__ import annotations

import asyncio
import logging
import signal

from dataset_studio.api.container import AppContainer
from dataset_studio.core.config import settings
from dataset_studio.modules.exports.worker import ExportWorker
from dataset_studio.modules.jobs.worker import AnnotationWorker
from dataset_studio.modules.taggers.downloads.worker import TaggerDownloadWorker


async def run_worker() -> None:
    stopped = asyncio.Event()
    loop = asyncio.get_running_loop()

    def request_stop(_signum=None, _frame=None) -> None:
        loop.call_soon_threadsafe(stopped.set)

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)
    container = AppContainer.create(settings)
    annotation_worker = AnnotationWorker(container)
    export_worker = ExportWorker(container)
    tagger_download_worker = TaggerDownloadWorker(container)
    worker_tasks = (
        asyncio.create_task(annotation_worker.run(stopped)),
        asyncio.create_task(export_worker.run(stopped)),
        asyncio.create_task(tagger_download_worker.run(stopped)),
    )
    try:
        await asyncio.gather(*worker_tasks)
    finally:
        stopped.set()
        try:
            await asyncio.gather(*worker_tasks, return_exceptions=True)
        finally:
            await container.aclose()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    asyncio.run(run_worker())


if __name__ == "__main__":
    main()
