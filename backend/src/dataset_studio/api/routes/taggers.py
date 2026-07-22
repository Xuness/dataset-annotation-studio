from typing import Annotated

from fastapi import APIRouter, Depends, status

from dataset_studio.api.container import AppContainer
from dataset_studio.api.dependencies import get_container
from dataset_studio.modules.taggers.models import (
    TaggerImportRequest,
    TaggerInstallation,
    TaggerLibrary,
    TaggerProfile,
    TaggerProfileCreate,
    TaggerProfileUpdate,
    TaggerSettingsUpdate,
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
