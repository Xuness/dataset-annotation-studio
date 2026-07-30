from typing import Annotated

from fastapi import APIRouter, Depends

from dataset_studio.api.container import AppContainer
from dataset_studio.api.dependencies import get_container
from dataset_studio.modules.tokenization.models import (
    TokenCountRequest,
    TokenCountResponse,
    TokenizationProfile,
)

router = APIRouter(prefix="/tokenization", tags=["tokenization"])
Container = Annotated[AppContainer, Depends(get_container)]


@router.get("/profiles", response_model=list[TokenizationProfile])
def list_profiles(container: Container):
    return container.tokenization.list_profiles()


@router.post("/count", response_model=TokenCountResponse)
def count_tokens(data: TokenCountRequest, container: Container):
    return container.tokenization.count(data)
