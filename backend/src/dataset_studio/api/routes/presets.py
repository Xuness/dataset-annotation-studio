from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from dataset_studio.api.container import AppContainer
from dataset_studio.api.dependencies import get_container
from dataset_studio.modules.presets.models import (
    ProviderProfile,
    ProviderProfileCreate,
    ProviderProfileUpdate,
    SystemPreset,
    SystemPresetCreate,
    SystemPresetUpdate,
)

router = APIRouter(prefix="/presets", tags=["presets"])
Container = Annotated[AppContainer, Depends(get_container)]


@router.get("/system", response_model=list[SystemPreset])
def list_system_presets(container: Container):
    return container.presets.list_system()


@router.post("/system", response_model=SystemPreset, status_code=status.HTTP_201_CREATED)
def create_system_preset(data: SystemPresetCreate, container: Container):
    return container.presets.create_system(data)


@router.patch("/system/{preset_id}", response_model=SystemPreset)
def update_system_preset(preset_id: str, data: SystemPresetUpdate, container: Container):
    return container.presets.update_system(preset_id, data)


@router.delete("/system/{preset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_system_preset(preset_id: str, container: Container):
    container.presets.delete_system(preset_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/providers", response_model=list[ProviderProfile])
def list_provider_profiles(container: Container):
    return container.presets.list_providers()


@router.post("/providers", response_model=ProviderProfile, status_code=status.HTTP_201_CREATED)
def create_provider_profile(data: ProviderProfileCreate, container: Container):
    return container.presets.create_provider(data)


@router.patch("/providers/{profile_id}", response_model=ProviderProfile)
def update_provider_profile(profile_id: str, data: ProviderProfileUpdate, container: Container):
    return container.presets.update_provider(profile_id, data)


@router.delete("/providers/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_provider_profile(profile_id: str, container: Container):
    container.presets.delete_provider(profile_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
