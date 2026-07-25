from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from dataset_studio.api.container import AppContainer
from dataset_studio.api.dependencies import get_container
from dataset_studio.modules.taggers.downloads.models import (
    HuggingFaceConnectionSettings,
    HuggingFaceConnectionTest,
    HuggingFaceSettingsUpdate,
    TaggerDownloadCenter,
    TaggerDownloadCreate,
    TaggerDownloadTask,
)
from dataset_studio.modules.taggers.models import (
    TaggerImportRequest,
    TaggerInstallation,
    TaggerLibrary,
    TaggerProfile,
    TaggerProfileCreate,
    TaggerProfileUpdate,
    TaggerSettingsUpdate,
    TaggerVocabularySearchResult,
)

router = APIRouter(prefix="/taggers", tags=["taggers"])
Container = Annotated[AppContainer, Depends(get_container)]


@router.get("", response_model=TaggerLibrary)
def get_library(container: Container):
    return container.taggers.library()


@router.patch("/settings", response_model=TaggerLibrary)
def update_settings(data: TaggerSettingsUpdate, container: Container):
    return container.taggers.update_settings(data)


@router.post("/import", response_model=TaggerLibrary, status_code=status.HTTP_201_CREATED)
def import_local(data: TaggerImportRequest, container: Container):
    return container.taggers.import_local(data)


@router.post("/rescan", response_model=TaggerLibrary)
def rescan(container: Container):
    return container.taggers.rescan()


@router.post("/installations/{installation_id}/validate", response_model=TaggerInstallation)
def validate_installation(installation_id: str, container: Container):
    return container.taggers.validate_installation(installation_id)


@router.get(
    "/installations/{installation_id}/vocabulary/search",
    response_model=TaggerVocabularySearchResult,
)
def search_vocabulary(
    installation_id: str,
    container: Container,
    q: str = Query(min_length=1, max_length=200),
    category: str | None = Query(default=None, max_length=120),
    limit: int = Query(default=24, ge=1, le=50),
):
    return container.taggers.search_vocabulary(
        installation_id,
        q,
        category=category,
        limit=limit,
    )


@router.delete("/installations/{installation_id}", response_model=TaggerLibrary)
def delete_installation(installation_id: str, container: Container):
    with container.taggers.catalog_guard():
        if container.jobs.is_tagger_installation_active(installation_id):
            raise ValueError("仍有运行中的任务使用这个本地打标器，请先停止任务再删除。")
        container.tagger_runtime.evict(installation_id)
        return container.taggers.delete_installation(installation_id)


@router.post("/profiles", response_model=TaggerProfile, status_code=status.HTTP_201_CREATED)
def create_profile(data: TaggerProfileCreate, container: Container):
    return container.taggers.create_profile(data)


@router.patch("/profiles/{profile_id}", response_model=TaggerProfile)
def update_profile(profile_id: str, data: TaggerProfileUpdate, container: Container):
    return container.taggers.update_profile(profile_id, data)


@router.delete("/profiles/{profile_id}", response_model=TaggerLibrary)
def delete_profile(profile_id: str, container: Container):
    return container.taggers.delete_profile(profile_id)


@router.get("/downloads", response_model=TaggerDownloadCenter)
def get_download_center(container: Container):
    return container.tagger_downloads.center()


@router.post(
    "/downloads",
    response_model=TaggerDownloadTask,
    status_code=status.HTTP_201_CREATED,
)
def create_download(data: TaggerDownloadCreate, container: Container):
    return container.tagger_downloads.create(data)


@router.get("/downloads/tasks", response_model=list[TaggerDownloadTask])
def get_download_tasks(container: Container):
    return container.tagger_downloads.tasks()


@router.post("/downloads/{task_id}/pause", response_model=TaggerDownloadTask)
def pause_download(task_id: str, container: Container):
    return container.tagger_downloads.pause(task_id)


@router.post("/downloads/{task_id}/resume", response_model=TaggerDownloadTask)
def resume_download(task_id: str, container: Container):
    return container.tagger_downloads.resume(task_id)


@router.delete("/downloads/{task_id}", response_model=TaggerDownloadCenter)
def delete_download(task_id: str, container: Container):
    return container.tagger_downloads.delete(task_id)


@router.get("/huggingface", response_model=HuggingFaceConnectionSettings)
def get_huggingface_settings(container: Container):
    return container.tagger_downloads.connection_settings()


@router.patch("/huggingface", response_model=HuggingFaceConnectionSettings)
def update_huggingface_settings(
    data: HuggingFaceSettingsUpdate,
    container: Container,
):
    return container.tagger_downloads.update_connection_settings(data)


@router.post("/huggingface/test", response_model=HuggingFaceConnectionTest)
def test_huggingface_connection(container: Container):
    return container.tagger_downloads.test_connection()
