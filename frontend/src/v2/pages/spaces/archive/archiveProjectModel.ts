import type { WorkspaceSummary } from "../../../../shared/api/types";

import type { ArchiveProjectRecord } from "../spacePageModel";

export function toArchiveProjectRecord(workspace: WorkspaceSummary): ArchiveProjectRecord {
  return {
    id: workspace.project_id,
    name: workspace.name,
    rootPath: workspace.root_path,
    exists: workspace.exists,
    assetCount: workspace.asset_count,
    annotatedCount: workspace.annotated_count,
    invalidCount: workspace.invalid_count,
    createdAt: workspace.created_at,
    lastOpenedAt: workspace.last_opened_at ?? null,
  };
}
