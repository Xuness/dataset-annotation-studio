from typing import Annotated

from fastapi import APIRouter, Depends

from dataset_studio.api.container import AppContainer
from dataset_studio.api.dependencies import get_container
from dataset_studio.modules.annotations.models import AnnotationDocument, AnnotationUpdate

router = APIRouter(
    prefix="/workspaces/{project_id}/assets/{asset_id}/annotation",
    tags=["annotations"],
)
Container = Annotated[AppContainer, Depends(get_container)]


@router.get("", response_model=AnnotationDocument)
def get_annotation(project_id: str, asset_id: str, container: Container):
    return container.annotations.get(project_id, asset_id)


@router.put("", response_model=AnnotationDocument)
def save_annotation(project_id: str, asset_id: str, update: AnnotationUpdate, container: Container):
    return container.annotations.save(project_id, asset_id, update.content)


@router.delete("", response_model=AnnotationDocument)
def delete_annotation(project_id: str, asset_id: str, container: Container):
    return container.annotations.delete(project_id, asset_id)


@router.get("/history")
def annotation_history(project_id: str, asset_id: str, container: Container):
    return container.annotations.history(project_id, asset_id)
