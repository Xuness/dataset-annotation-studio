from __future__ import annotations

from typing import Final

from dataset_studio.core.migrations import Migration
from dataset_studio.modules.workspaces.migrations.v001_initial_workspace_schema import (
    MIGRATION as V001_INITIAL_WORKSPACE_SCHEMA,
)
from dataset_studio.modules.workspaces.migrations.v002_image_metadata_version import (
    MIGRATION as V002_IMAGE_METADATA_VERSION,
)
from dataset_studio.modules.workspaces.migrations.v003_job_item_asset_updated_index import (
    MIGRATION as V003_JOB_ITEM_ASSET_UPDATED_INDEX,
)
from dataset_studio.modules.workspaces.migrations.v004_job_attempt_usage_details import (
    MIGRATION as V004_JOB_ATTEMPT_USAGE_DETAILS,
)
from dataset_studio.modules.workspaces.migrations.v005_translation_jobs import (
    MIGRATION as V005_TRANSLATION_JOBS,
)
from dataset_studio.modules.workspaces.migrations.v006_export_operations import (
    MIGRATION as V006_EXPORT_OPERATIONS,
)
from dataset_studio.modules.workspaces.migrations.v007_preprocess_recovery_journal import (
    MIGRATION as V007_PREPROCESS_RECOVERY_JOURNAL,
)
from dataset_studio.modules.workspaces.migrations.v008_job_execution_backend import (
    MIGRATION as V008_JOB_EXECUTION_BACKEND,
)
from dataset_studio.modules.workspaces.migrations.v009_asset_deletions import (
    MIGRATION as V009_ASSET_DELETIONS,
)
from dataset_studio.modules.workspaces.migrations.v010_output_resource_leases import (
    MIGRATION as V010_OUTPUT_RESOURCE_LEASES,
)
from dataset_studio.modules.workspaces.migrations.v011_database_annotation_store import (
    MIGRATION as V011_DATABASE_ANNOTATION_STORE,
)
from dataset_studio.modules.workspaces.migrations.v012_annotation_review_decoupling import (
    MIGRATION as V012_ANNOTATION_REVIEW_DECOUPLING,
)
from dataset_studio.modules.workspaces.migrations.v013_output_resource_owner import (
    MIGRATION as V013_OUTPUT_RESOURCE_OWNER,
)
from dataset_studio.modules.workspaces.migrations.v014_annotation_relation_invariants import (
    MIGRATION as V014_ANNOTATION_RELATION_INVARIANTS,
)
from dataset_studio.modules.workspaces.migrations.v015_preprocess_execution_runtime import (
    MIGRATION as V015_PREPROCESS_EXECUTION_RUNTIME,
)
from dataset_studio.modules.workspaces.migrations.v016_translation_variants import (
    MIGRATION as V016_TRANSLATION_VARIANTS,
)

WORKSPACE_MIGRATIONS: Final[tuple[Migration, ...]] = (
    V001_INITIAL_WORKSPACE_SCHEMA,
    V002_IMAGE_METADATA_VERSION,
    V003_JOB_ITEM_ASSET_UPDATED_INDEX,
    V004_JOB_ATTEMPT_USAGE_DETAILS,
    V005_TRANSLATION_JOBS,
    V006_EXPORT_OPERATIONS,
    V007_PREPROCESS_RECOVERY_JOURNAL,
    V008_JOB_EXECUTION_BACKEND,
    V009_ASSET_DELETIONS,
    V010_OUTPUT_RESOURCE_LEASES,
    V011_DATABASE_ANNOTATION_STORE,
    V012_ANNOTATION_REVIEW_DECOUPLING,
    V013_OUTPUT_RESOURCE_OWNER,
    V014_ANNOTATION_RELATION_INVARIANTS,
    V015_PREPROCESS_EXECUTION_RUNTIME,
    V016_TRANSLATION_VARIANTS,
)
WORKSPACE_SCHEMA_VERSION: Final = WORKSPACE_MIGRATIONS[-1].version
