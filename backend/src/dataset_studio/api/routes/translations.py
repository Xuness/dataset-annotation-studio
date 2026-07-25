from typing import Annotated

from fastapi import APIRouter, Depends

from dataset_studio.api.container import AppContainer
from dataset_studio.api.dependencies import get_container
from dataset_studio.modules.translations.identity import (
    DEFAULT_TRANSLATION_PRODUCER_KIND,
    DEFAULT_TRANSLATION_SOURCE_KIND,
    TranslationProducerKind,
    TranslationSourceKind,
)
from dataset_studio.modules.translations.models import (
    LocalDictionaryTranslationRefreshRequest,
    TranslationDocument,
)

router = APIRouter(
    prefix="/workspaces/{project_id}/assets/{asset_id}/translations",
    tags=["translations"],
)
Container = Annotated[AppContainer, Depends(get_container)]


@router.get("", response_model=list[TranslationDocument])
def list_translations(project_id: str, asset_id: str, container: Container):
    return container.translations.list(project_id, asset_id)


@router.get("/{language}", response_model=TranslationDocument)
def get_translation(
    project_id: str,
    asset_id: str,
    language: str,
    container: Container,
    source_kind: TranslationSourceKind = DEFAULT_TRANSLATION_SOURCE_KIND,
    producer_kind: TranslationProducerKind = DEFAULT_TRANSLATION_PRODUCER_KIND,
):
    return container.translations.get(
        project_id,
        asset_id,
        language,
        source_kind=source_kind,
        producer_kind=producer_kind,
    )


@router.post("/{language}/local-dictionary/refresh", response_model=TranslationDocument)
def refresh_local_dictionary_translation(
    project_id: str,
    asset_id: str,
    language: str,
    data: LocalDictionaryTranslationRefreshRequest,
    container: Container,
):
    return container.translations.refresh_local_dictionary(
        project_id,
        asset_id,
        language,
        expected_source_revision_id=data.expected_source_revision_id,
        expected_translation_revision_id=data.expected_translation_revision_id,
    )
