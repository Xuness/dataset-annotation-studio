from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from dataset_studio.api.container import AppContainer
from dataset_studio.api.dependencies import get_container
from dataset_studio.modules.providers.codex_models import (
    CodexAccountStatus,
    CodexLoginStart,
    CodexLoginStatus,
)

router = APIRouter(prefix="/providers/codex", tags=["providers"])
Container = Annotated[AppContainer, Depends(get_container)]


@router.get("/account", response_model=CodexAccountStatus)
async def codex_account(container: Container):
    return await container.codex.account_status()


@router.post("/login", response_model=CodexLoginStart, status_code=status.HTTP_201_CREATED)
async def start_codex_login(container: Container):
    return await container.codex.start_chatgpt_login()


@router.get("/login/{login_id}", response_model=CodexLoginStatus)
async def codex_login_status(login_id: str, container: Container):
    return await container.codex.login_status(login_id)


@router.delete("/login/{login_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_codex_login(login_id: str, container: Container):
    await container.codex.cancel_login(login_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
