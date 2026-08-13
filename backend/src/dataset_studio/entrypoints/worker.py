from __future__ import annotations

import asyncio
import logging
import signal

from dataset_studio.api.container import AppContainer
from dataset_studio.core.config import settings
from dataset_studio.modules.exports.worker import ExportWorker
from dataset_studio.modules.jobs.worker import AnnotationWorker
from dataset_studio.modules.output_resources import configure_output_resource_owner
from dataset_studio.modules.screening.worker import ScreeningWorker
from dataset_studio.modules.tag_dictionaries.downloads.worker import (
    TagDictionaryDownloadWorker,
)
from dataset_studio.modules.taggers.downloads.worker import TaggerDownloadWorker


async def run_worker() -> None:
    configure_output_resource_owner("worker")
    stopped = asyncio.Event()
    loop = asyncio.get_running_loop()

    def request_stop(_signum=None, _frame=None) -> None:
        loop.call_soon_threadsafe(stopped.set)

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)
    container = AppContainer.create(settings)
    annotation_worker = AnnotationWorker(container)
    export_worker = ExportWorker(container)
    screening_worker = ScreeningWorker(container)
    tagger_download_worker = TaggerDownloadWorker(container)
    tag_dictionary_download_worker = TagDictionaryDownloadWorker(container)
    worker_tasks = (
        asyncio.create_task(annotation_worker.run(stopped)),
        asyncio.create_task(export_worker.run(stopped)),
        asyncio.create_task(screening_worker.run(stopped)),
        asyncio.create_task(tagger_download_worker.run(stopped)),
        asyncio.create_task(tag_dictionary_download_worker.run(stopped)),
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
