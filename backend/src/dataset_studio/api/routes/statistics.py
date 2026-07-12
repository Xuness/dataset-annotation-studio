from typing import Annotated

from fastapi import APIRouter, Depends

from dataset_studio.api.container import AppContainer
from dataset_studio.api.dependencies import get_container
from dataset_studio.modules.statistics.models import AnnotationStatistics

router = APIRouter(prefix="/workspaces/{project_id}/statistics", tags=["statistics"])
Container = Annotated[AppContainer, Depends(get_container)]


@router.get("/tag-frequency", response_model=AnnotationStatistics)
def tag_frequency(project_id: str, container: Container):
    return container.statistics.tag_frequency(project_id)
