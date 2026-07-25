import uvicorn

from dataset_studio.core.config import settings
from dataset_studio.modules.output_resources import configure_output_resource_owner


def main() -> None:
    configure_output_resource_owner("api")
    uvicorn.run(
        "dataset_studio.api.app:app",
        host=settings.host,
        port=settings.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
