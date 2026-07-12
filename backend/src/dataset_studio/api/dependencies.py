from fastapi import Request

from dataset_studio.api.container import AppContainer


def get_container(request: Request) -> AppContainer:
    return request.app.state.container
