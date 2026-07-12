from __future__ import annotations

import asyncio
import logging
import signal

from dataset_studio.api.container import AppContainer
from dataset_studio.core.config import settings
from dataset_studio.modules.jobs.worker import AnnotationWorker


async def run_worker() -> None:
    stopped = asyncio.Event()
    loop = asyncio.get_running_loop()

    def request_stop(_signum=None, _frame=None) -> None:
        loop.call_soon_threadsafe(stopped.set)

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)
    worker = AnnotationWorker(AppContainer.create(settings))
    await worker.run(stopped)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    asyncio.run(run_worker())


if __name__ == "__main__":
    main()
