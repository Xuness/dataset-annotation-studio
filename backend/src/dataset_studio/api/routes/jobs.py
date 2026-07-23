from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query

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
    jobs = container.jobs.active_overview()
    preprocessing_count, _ = container.preprocessing.active_overview()
    export_count, _ = container.exports.active_overview()
    asset_deletion_count, _ = container.asset_deletions.active_overview()
    active_projects = (
        container.jobs.active_project_ids()
        | container.preprocessing.active_project_ids(preprocessing_only=True)
        | container.exports.active_project_ids()
        | container.asset_deletions.active_project_ids()
    )
    return ActiveJobsOverview(
        count=jobs.count + preprocessing_count + export_count + asset_deletion_count,
        project_count=len(active_projects),
        annotation_job_count=jobs.annotation_job_count,
        translation_job_count=jobs.translation_job_count,
        preprocessing_count=preprocessing_count,
        export_count=export_count,
        asset_deletion_count=asset_deletion_count,
    )


@global_router.post("/stop-all")
def stop_all_workspace_jobs(container: Container):
    return {
        "stopped": (container.jobs.stop_all_workspaces() + container.exports.stop_all_workspaces())
    }


@router.get("", response_model=list[JobSummary])
def list_jobs(
    project_id: str,
    container: Container,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    active_only: bool = False,
):
    return container.jobs.list(
        project_id,
        offset=offset,
        limit=limit,
        active_only=active_only,
    )


@router.post("", response_model=JobDetail)
def create_job(project_id: str, request: JobCreateRequest, container: Container):
    with container.preprocessing.guard_workspace(project_id, "create-job"):
        container.exports.ensure_inactive(project_id)
        container.asset_deletions.ensure_persisted_inactive(project_id)
        return container.jobs.create(project_id, request, include_items=False)


@router.post("/stop-all")
def stop_all_jobs(project_id: str, container: Container):
    return {"stopped": container.jobs.stop_all(project_id)}


@router.get("/{job_id}", response_model=JobDetail)
def get_job(
    project_id: str,
    job_id: str,
    container: Container,
    items: Literal["all", "failed", "none"] = "all",
    item_offset: int = Query(default=0, ge=0),
    item_limit: int = Query(default=200, ge=1, le=1_000_000),
):
    return container.jobs.get(
        project_id,
        job_id,
        include_items=items != "none",
        failed_items_only=items == "failed",
        item_offset=item_offset,
        item_limit=item_limit,
    )


@router.post("/{job_id}/stop", response_model=JobDetail)
def stop_job(project_id: str, job_id: str, container: Container):
    return container.jobs.stop(project_id, job_id, include_items=False)


@router.post("/{job_id}/resume", response_model=JobDetail)
def resume_job(project_id: str, job_id: str, container: Container):
    with container.preprocessing.guard_workspace(project_id, f"resume-job:{job_id}"):
        container.exports.ensure_inactive(project_id)
        container.asset_deletions.ensure_persisted_inactive(project_id)
        return container.jobs.resume(project_id, job_id, include_items=False)


@router.post("/{job_id}/retry-failed", response_model=JobDetail)
def retry_failed(project_id: str, job_id: str, container: Container):
    with container.preprocessing.guard_workspace(project_id, f"retry-job:{job_id}"):
        container.exports.ensure_inactive(project_id)
        container.asset_deletions.ensure_persisted_inactive(project_id)
        return container.jobs.retry_failed(project_id, job_id, include_items=False)


@router.post("/{job_id}/items/{item_id}/accept", response_model=JobDetail)
def manually_accept(project_id: str, job_id: str, item_id: str, container: Container):
    with container.preprocessing.guard_workspace(project_id, f"accept-item:{item_id}"):
        container.exports.ensure_inactive(project_id)
        container.asset_deletions.ensure_persisted_inactive(project_id)
        return container.jobs.manually_accept(
            project_id,
            job_id,
            item_id,
            include_items=False,
        )
