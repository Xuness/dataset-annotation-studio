from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from dataset_studio.api.container import AppContainer
from dataset_studio.api.dependencies import get_container
from dataset_studio.modules.presets.models import (
    ProviderModelSearchRequest,
    ProviderProfile,
    ProviderProfileCreate,
    ProviderProfileUpdate,
    SystemPreset,
    SystemPresetCreate,
    SystemPresetUpdate,
)
from dataset_studio.modules.providers.catalog import search_provider_models
from dataset_studio.modules.providers.models import ProviderModelSummary

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


@router.post("/provider-models/search", response_model=list[ProviderModelSummary])
async def search_models(data: ProviderModelSearchRequest, container: Container):
    provider_type = data.provider_type
    base_url = data.base_url
    api_key = data.api_key

    if data.profile_id:
        profile = container.presets.get_provider(data.profile_id)
        provider_type = provider_type or profile.provider_type
        base_url = base_url or profile.base_url
        if (
            not api_key
            and provider_type == profile.provider_type
            and base_url.rstrip("/") == profile.base_url.rstrip("/")
        ):
            try:
                api_key = container.presets.get_api_key(profile.id)
            except ValueError:
                api_key = None

    if provider_type is None or not base_url:
        raise ValueError("无法确定模型目录对应的供应商与 API 地址。")
    return await search_provider_models(
        provider_type,
        base_url,
        api_key,
        data.query,
        data.limit,
    )
