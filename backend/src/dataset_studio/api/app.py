from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from dataset_studio import __version__
from dataset_studio.api.container import AppContainer
from dataset_studio.api.routes import (
    annotations,
    asset_deletions,
    assets,
    exports,
    jobs,
    preprocessing,
    presets,
    providers,
    statistics,
    system,
    tag_dictionaries,
    taggers,
    tokenization,
    translations,
    workspaces,
)
from dataset_studio.core.config import Settings, settings
from dataset_studio.core.errors import (
    ResourceConflictError,
    SecretStoreUnavailableError,
    StudioError,
)
from dataset_studio.modules.providers.models import ProviderRequestError


def create_app(app_settings: Settings = settings) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        container = AppContainer.create(app_settings)
        app.state.container = container
        try:
            yield
        finally:
            await container.aclose()

    app = FastAPI(
        title="Dataset Annotation Studio API",
        version=__version__,
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            f"http://localhost:{app_settings.frontend_port}",
            f"http://127.0.0.1:{app_settings.frontend_port}",
            "tauri://localhost",
            "http://tauri.localhost",
        ],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(StudioError)
    async def studio_error_handler(_request: Request, error: StudioError):
        return JSONResponse(status_code=404, content={"detail": str(error)})

    @app.exception_handler(SecretStoreUnavailableError)
    async def secret_store_unavailable_handler(
        _request: Request,
        error: SecretStoreUnavailableError,
    ):
        return JSONResponse(status_code=503, content={"detail": str(error)})

    @app.exception_handler(ValueError)
    async def value_error_handler(_request: Request, error: ValueError):
        return JSONResponse(status_code=400, content={"detail": str(error)})

    @app.exception_handler(ResourceConflictError)
    async def resource_conflict_handler(_request: Request, error: ResourceConflictError):
        return JSONResponse(status_code=409, content={"detail": str(error)})

    @app.exception_handler(ProviderRequestError)
    async def provider_request_error_handler(_request: Request, error: ProviderRequestError):
        return JSONResponse(status_code=502, content={"detail": str(error)})

    @app.get("/health", tags=["system"])
    def health():
        return {"status": "ok", "version": __version__}

    api_prefix = "/api/v1"
    app.include_router(workspaces.router, prefix=api_prefix)
    app.include_router(assets.router, prefix=api_prefix)
    app.include_router(asset_deletions.router, prefix=api_prefix)
    app.include_router(annotations.router, prefix=api_prefix)
    app.include_router(annotations.batch_router, prefix=api_prefix)
    app.include_router(annotations.channels_router, prefix=api_prefix)
    app.include_router(translations.router, prefix=api_prefix)
    app.include_router(presets.router, prefix=api_prefix)
    app.include_router(providers.router, prefix=api_prefix)
    app.include_router(jobs.router, prefix=api_prefix)
    app.include_router(jobs.global_router, prefix=api_prefix)
    app.include_router(preprocessing.router, prefix=api_prefix)
    app.include_router(exports.router, prefix=api_prefix)
    app.include_router(statistics.router, prefix=api_prefix)
    app.include_router(system.router, prefix=api_prefix)
    app.include_router(taggers.router, prefix=api_prefix)
    app.include_router(tag_dictionaries.router, prefix=api_prefix)
    app.include_router(tokenization.router, prefix=api_prefix)
    return app


app = create_app()
