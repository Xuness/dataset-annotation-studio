from typing import Annotated

from fastapi import APIRouter, Depends

from dataset_studio.api.container import AppContainer
from dataset_studio.api.dependencies import get_container
from dataset_studio.modules.character_audits import repository, service, vocabulary
from dataset_studio.modules.character_audits.models import (
    ApplyPreview,
    ApplyRequest,
    AuditCreateRequest,
    AuditOperation,
    AuditSummary,
    MembershipPreview,
    PrepareTagsRequest,
    ResolutionsUpdate,
    ReviewUpdate,
    VersionRequest,
    VocabularyImport,
    VocabularyLibrary,
    VocabularyManifest,
)

router = APIRouter(prefix="/workspaces/{project_id}/character-audits", tags=["character-audits"])
library_router = APIRouter(prefix="/character-audit-vocabularies", tags=["character-audits"])
Container = Annotated[AppContainer, Depends(get_container)]


@library_router.get("", response_model=VocabularyLibrary)
def list_vocabularies(container: Container):
    return vocabulary.list_vocabularies(container.tag_dictionaries.dictionary_root())


@library_router.post("", response_model=VocabularyManifest, status_code=201)
def import_vocabulary(request: VocabularyImport, container: Container):
    return vocabulary.import_vocabulary(container.tag_dictionaries.dictionary_root(), request)


@router.post("/membership-preview", response_model=MembershipPreview)
def preview_membership(project_id: str, request: AuditCreateRequest, container: Container):
    return service.preview_membership(container, project_id, request)


@router.post("", response_model=AuditOperation, status_code=201)
def create_audit(project_id: str, request: AuditCreateRequest, container: Container):
    return service.create(container, project_id, request)


@router.get("", response_model=list[AuditSummary])
def list_audits(project_id: str, container: Container):
    paths, _ = container.workspaces.get(project_id)
    return repository.list_operations(paths.database)


@router.get("/{operation_id}", response_model=AuditOperation)
def get_audit(project_id: str, operation_id: str, container: Container):
    paths, _ = container.workspaces.get(project_id)
    return repository.get_operation(paths.database, operation_id)


@router.post("/{operation_id}/prepare-tags", response_model=AuditOperation)
def prepare_tags(
    project_id: str, operation_id: str, request: PrepareTagsRequest, container: Container
):
    with container.preprocessing.guard_workspace(project_id, "character-audit-prepare"):
        container.exports.ensure_inactive(project_id)
        container.asset_deletions.ensure_persisted_inactive(project_id)
        container.screening.ensure_inactive(project_id)
        return service.prepare_tags(container, project_id, operation_id, request)


@router.post("/{operation_id}/start", response_model=AuditOperation)
def start_audit(project_id: str, operation_id: str, request: VersionRequest, container: Container):
    with container.preprocessing.guard_workspace(project_id, "character-audit-start"):
        container.exports.ensure_inactive(project_id)
        container.asset_deletions.ensure_persisted_inactive(project_id)
        container.screening.ensure_inactive(project_id)
        return service.start(container, project_id, operation_id, request.version)


@router.post("/{operation_id}/stop", response_model=AuditOperation)
def stop_audit(project_id: str, operation_id: str, container: Container):
    return service.stop(container, project_id, operation_id)


@router.put("/{operation_id}/profiles/{profile_index}", response_model=AuditOperation)
def save_review(
    project_id: str,
    operation_id: str,
    profile_index: int,
    request: ReviewUpdate,
    container: Container,
):
    return service.save_review(container, project_id, operation_id, profile_index, request)


@router.post("/{operation_id}/profiles/{profile_index}/redo-visual", response_model=AuditOperation)
def redo_visual(
    project_id: str,
    operation_id: str,
    profile_index: int,
    request: VersionRequest,
    container: Container,
):
    return service.redo_visual(container, project_id, operation_id, profile_index, request.version)


@router.put("/{operation_id}/resolutions", response_model=AuditOperation)
def save_resolutions(
    project_id: str, operation_id: str, request: ResolutionsUpdate, container: Container
):
    return service.save_resolutions(container, project_id, operation_id, request)


@router.post("/{operation_id}/preview", response_model=ApplyPreview)
def preview_audit(project_id: str, operation_id: str, container: Container):
    return service.preview(container, project_id, operation_id)


@router.post("/{operation_id}/apply", response_model=AuditOperation)
def apply_audit(project_id: str, operation_id: str, request: ApplyRequest, container: Container):
    with container.preprocessing.guard_workspace(project_id, "character-audit-apply"):
        container.exports.ensure_inactive(project_id)
        container.asset_deletions.ensure_persisted_inactive(project_id)
        container.screening.ensure_inactive(project_id)
        return service.apply(container, project_id, operation_id, request.preview_token)
