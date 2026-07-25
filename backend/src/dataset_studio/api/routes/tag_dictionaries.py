from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status

from dataset_studio.api.container import AppContainer
from dataset_studio.api.dependencies import get_container
from dataset_studio.core.languages import normalize_language_code
from dataset_studio.modules.tag_dictionaries.downloads.models import (
    TagDictionaryDownloadCenter,
    TagDictionaryDownloadCreate,
    TagDictionaryDownloadTask,
)
from dataset_studio.modules.tag_dictionaries.models import (
    TagDictionaryImportRequest,
    TagDictionaryInstallation,
    TagDictionaryInstallationUpdate,
    TagDictionaryLibrary,
    TagDictionaryOrderUpdate,
    TagDictionaryOverride,
    TagDictionaryOverrideUpsert,
    TagDictionaryResolution,
    TagDictionaryResolveRequest,
    TagDictionarySearchResult,
)

router = APIRouter(prefix="/tag-dictionaries", tags=["tag-dictionaries"])
Container = Annotated[AppContainer, Depends(get_container)]


@router.get("", response_model=TagDictionaryLibrary)
def get_library(container: Container):
    return container.tag_dictionaries.library()


@router.post("", response_model=TagDictionaryLibrary, status_code=status.HTTP_201_CREATED)
def import_local(data: TagDictionaryImportRequest, container: Container):
    return container.tag_dictionaries.import_local(data)


@router.patch(
    "/installations/{installation_id}",
    response_model=TagDictionaryInstallation,
)
def update_installation(
    installation_id: str,
    data: TagDictionaryInstallationUpdate,
    container: Container,
):
    return container.tag_dictionaries.update_installation(installation_id, data)


@router.put("/order", response_model=TagDictionaryLibrary)
def reorder(data: TagDictionaryOrderUpdate, container: Container):
    return container.tag_dictionaries.reorder(data)


@router.delete("/installations/{installation_id}", response_model=TagDictionaryLibrary)
def delete_installation(installation_id: str, container: Container):
    return container.tag_dictionaries.delete_installation(installation_id)


@router.get("/entries/search", response_model=TagDictionarySearchResult)
def search_entries(
    container: Container,
    q: str = Query(min_length=1, max_length=500),
    language: str = Query(default="zh-CN", max_length=30),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
):
    return container.tag_dictionaries.search(
        q,
        normalize_language_code(language),
        offset=offset,
        limit=limit,
    )


@router.post("/resolve", response_model=TagDictionaryResolution)
def resolve_entries(data: TagDictionaryResolveRequest, container: Container):
    return container.tag_dictionaries.resolve(data.tags, data.language)


@router.put("/overrides", response_model=TagDictionaryOverride)
def upsert_override(data: TagDictionaryOverrideUpsert, container: Container):
    return container.tag_dictionaries.upsert_override(data)


@router.delete("/overrides", status_code=status.HTTP_204_NO_CONTENT)
def delete_override(
    container: Container,
    tag: str = Query(min_length=1, max_length=500),
    language: str = Query(default="zh-CN", max_length=30),
):
    container.tag_dictionaries.delete_override(tag, normalize_language_code(language))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/downloads", response_model=TagDictionaryDownloadCenter)
def get_download_center(container: Container):
    return container.tag_dictionary_downloads.center()


@router.post(
    "/downloads",
    response_model=TagDictionaryDownloadTask,
    status_code=status.HTTP_201_CREATED,
)
def create_download(data: TagDictionaryDownloadCreate, container: Container):
    return container.tag_dictionary_downloads.create(data)


@router.get("/downloads/tasks", response_model=list[TagDictionaryDownloadTask])
def get_download_tasks(container: Container):
    return container.tag_dictionary_downloads.tasks()


@router.post("/downloads/{task_id}/pause", response_model=TagDictionaryDownloadTask)
def pause_download(task_id: str, container: Container):
    return container.tag_dictionary_downloads.pause(task_id)


@router.post("/downloads/{task_id}/resume", response_model=TagDictionaryDownloadTask)
def resume_download(task_id: str, container: Container):
    return container.tag_dictionary_downloads.resume(task_id)


@router.delete("/downloads/{task_id}", response_model=TagDictionaryDownloadCenter)
def delete_download(task_id: str, container: Container):
    return container.tag_dictionary_downloads.delete(task_id)
