import uvicorn

from dataset_studio.core.config import settings


def main() -> None:
    uvicorn.run(
        "dataset_studio.api.app:app",
        host=settings.host,
        port=settings.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
