from typing import Annotated

from fastapi import APIRouter, Depends

from dataset_studio.api.container import AppContainer
from dataset_studio.api.dependencies import get_container
from dataset_studio.modules.jobs.models import (
    ActiveJobsOverview,
    JobCreateRequest,
    JobDetail,
    JobSummary,
)

router = APIRouter(prefix="/workspaces/{project_id}/jobs", tags=["jobs"])
global_router = APIRouter(prefix="/jobs", tags=["jobs"])
Container = Annotated[AppContainer, Depends(get_container)]


@global_router.get("/active", response_model=ActiveJobsOverview)
def active_jobs(container: Container):
    return container.jobs.active_overview()


@global_router.post("/stop-all")
def stop_all_workspace_jobs(container: Container):
    return {"stopped": container.jobs.stop_all_workspaces()}


@router.get("", response_model=list[JobSummary])
def list_jobs(project_id: str, container: Container):
    return container.jobs.list(project_id)


@router.post("", response_model=JobDetail)
def create_job(project_id: str, request: JobCreateRequest, container: Container):
    return container.jobs.create(project_id, request)


@router.post("/stop-all")
def stop_all_jobs(project_id: str, container: Container):
    return {"stopped": container.jobs.stop_all(project_id)}


@router.get("/{job_id}", response_model=JobDetail)
def get_job(project_id: str, job_id: str, container: Container):
    return container.jobs.get(project_id, job_id)


@router.post("/{job_id}/stop", response_model=JobDetail)
def stop_job(project_id: str, job_id: str, container: Container):
    return container.jobs.stop(project_id, job_id)


@router.post("/{job_id}/resume", response_model=JobDetail)
def resume_job(project_id: str, job_id: str, container: Container):
    return container.jobs.resume(project_id, job_id)


@router.post("/{job_id}/retry-failed", response_model=JobDetail)
def retry_failed(project_id: str, job_id: str, container: Container):
    return container.jobs.retry_failed(project_id, job_id)


@router.post("/{job_id}/items/{item_id}/accept", response_model=JobDetail)
def manually_accept(project_id: str, job_id: str, item_id: str, container: Container):
    return container.jobs.manually_accept(project_id, job_id, item_id)
