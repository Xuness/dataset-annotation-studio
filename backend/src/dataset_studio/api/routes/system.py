from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from dataset_studio import __version__
from dataset_studio.api.container import AppContainer
from dataset_studio.api.dependencies import get_container

router = APIRouter(prefix="/system", tags=["system"])
Container = Annotated[AppContainer, Depends(get_container)]


class SystemDiagnostics(BaseModel):
    status: Literal["ok"]
    version: str
    app_data_dir: str
    log_dir: str


@router.get("/diagnostics", response_model=SystemDiagnostics)
def get_system_diagnostics(container: Container) -> SystemDiagnostics:
    app_data_dir = container.settings.app_data_dir
    return SystemDiagnostics(
        status="ok",
        version=__version__,
        app_data_dir=str(app_data_dir),
        log_dir=str(app_data_dir / "logs"),
    )
