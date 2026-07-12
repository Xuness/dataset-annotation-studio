from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse

from dataset_studio.api.container import AppContainer
from dataset_studio.api.dependencies import get_container
from dataset_studio.modules.assets.models import AssetListResponse, MetadataDocument
from dataset_studio.modules.prompts.composer import PromptPreview, preview_user_prompt

router = APIRouter(prefix="/workspaces/{project_id}/assets", tags=["assets"])
Container = Annotated[AppContainer, Depends(get_container)]


@router.get("", response_model=AssetListResponse)
def list_assets(
    project_id: str,
    container: Container,
    search: str = "",
    status: str | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=10_000),
):
    return container.assets.list_assets(
        project_id,
        search=search,
        annotation_status=status,
        offset=offset,
        limit=limit,
    )


@router.get("/{asset_id}/image")
def get_image(project_id: str, asset_id: str, container: Container):
    path = container.assets.image_path(project_id, asset_id)
    return FileResponse(path, content_disposition_type="inline")


@router.get("/{asset_id}/thumbnail")
def get_thumbnail(
    project_id: str,
    asset_id: str,
    container: Container,
    size: int = Query(default=320, ge=96, le=1024),
):
    path = container.assets.thumbnail_path(project_id, asset_id, size)
    return FileResponse(path, media_type="image/webp", content_disposition_type="inline")


@router.get("/{asset_id}/metadata", response_model=MetadataDocument)
def get_metadata(project_id: str, asset_id: str, container: Container):
    return container.assets.metadata(project_id, asset_id)


@router.get("/{asset_id}/prompt-preview", response_model=PromptPreview)
def get_prompt_preview(project_id: str, asset_id: str, container: Container):
    workspace = container.workspaces.get_summary(project_id)
    metadata = container.assets.metadata(project_id, asset_id)
    return preview_user_prompt(
        workspace.settings.user_prompt,
        metadata.value if metadata.exists and not metadata.error else None,
        workspace.settings.json_fields,
    )
