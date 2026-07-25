from typing import Annotated

from fastapi import APIRouter, Depends

from dataset_studio.api.container import AppContainer
from dataset_studio.api.dependencies import get_container
from dataset_studio.modules.preprocessing.models import (
    PreprocessExecuteRequest,
    PreprocessExecutionPlan,
    PreprocessExecutionPlanRequest,
    PreprocessOperation,
    PreprocessPreview,
    PreprocessRequest,
)

router = APIRouter(prefix="/workspaces/{project_id}/preprocessing", tags=["preprocessing"])
Container = Annotated[AppContainer, Depends(get_container)]


@router.post("/preview", response_model=PreprocessPreview)
def preview(project_id: str, request: PreprocessRequest, container: Container):
    return container.preprocessing.preview(project_id, request)


@router.post("/execution-plan", response_model=PreprocessExecutionPlan)
def execution_plan(
    project_id: str,
    payload: PreprocessExecutionPlanRequest,
    container: Container,
):
    return container.preprocessing.execution_plan(project_id, payload)


@router.post("/execute", response_model=PreprocessOperation)
def execute(project_id: str, execution: PreprocessExecuteRequest, container: Container):
    return container.preprocessing.execute(project_id, execution)


@router.get("/operations", response_model=list[PreprocessOperation])
def list_operations(project_id: str, container: Container):
    return container.preprocessing.list_operations(project_id)


@router.post("/operations/{operation_id}/undo", response_model=PreprocessOperation)
def undo(project_id: str, operation_id: str, container: Container):
    return container.preprocessing.undo(project_id, operation_id)
