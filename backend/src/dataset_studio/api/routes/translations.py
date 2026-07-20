from typing import Annotated

from fastapi import APIRouter, Depends

from dataset_studio.api.container import AppContainer
from dataset_studio.api.dependencies import get_container
from dataset_studio.modules.translations.models import TranslationDocument

router = APIRouter(
    prefix="/workspaces/{project_id}/assets/{asset_id}/translations",
    tags=["translations"],
)
Container = Annotated[AppContainer, Depends(get_container)]


@router.get("", response_model=list[TranslationDocument])
def list_translations(project_id: str, asset_id: str, container: Container):
    return container.translations.list(project_id, asset_id)


@router.get("/{language}", response_model=TranslationDocument)
def get_translation(project_id: str, asset_id: str, language: str, container: Container):
    return container.translations.get(project_id, asset_id, language)
