import type {
  CreateScreeningOperationRequest,
  CharacterLoraRules,
  ScreeningFlag,
  ScreeningItemQuery,
  ScreeningOperation,
  ScreeningPool,
  ScreeningProfile,
  ScreeningRating,
  ScreeningSort,
  ScreeningStrength,
} from "../../shared/api/types";
import { createScopedViewState } from "../../shared/store/scopedViewState.ts";

export type ScreeningScope = "all" | "folder" | "selected";

export interface ScreeningFormState {
  scope: ScreeningScope;
  folderPaths: string[];
  profile: ScreeningProfile;
  strength: ScreeningStrength;
  metadataSnapshotAtFallback: string;
  taskRules: CharacterLoraRules;
}

export interface ScreeningFilterState {
  pool: ScreeningPool | null;
  rating: ScreeningRating | null;
  flag: ScreeningFlag | null;
  sort: ScreeningSort;
  showDuplicates: boolean;
}

export interface ScreeningWorkbenchView {
  form: ScreeningFormState;
  filters: ScreeningFilterState;
  selectedOperationId: string | null;
  selectedAssetId: string | null;
  galleryDensity: "comfortable" | "compact";
}

export function createInitialScreeningForm(): ScreeningFormState {
  return {
    scope: "all",
    folderPaths: [],
    profile: "character_lora",
    strength: "balanced",
    metadataSnapshotAtFallback: "",
    taskRules: {
      comic_panel: true,
      multiple_views: true,
      monochrome_greyscale: true,
      lineart_sketch: true,
      crowd_3plus: true,
    },
  };
}

export const screeningWorkbenchState = createScopedViewState<ScreeningWorkbenchView>(() => ({
  form: createInitialScreeningForm(),
  filters: {
    pool: null,
    rating: null,
    flag: null,
    sort: "selection",
    showDuplicates: false,
  },
  selectedOperationId: null,
  selectedAssetId: null,
  galleryDensity: "comfortable",
}));

export function buildScreeningRequest(
  form: ScreeningFormState,
  checkedAssetIds: readonly string[],
  folderAssetIds: readonly string[],
  allAssetIds: readonly string[] = [],
): CreateScreeningOperationRequest {
  const snapshot = form.metadataSnapshotAtFallback.trim();
  const parsedSnapshot = snapshot ? Date.parse(snapshot) : Number.NaN;
  return {
    asset_ids:
      form.scope === "selected"
        ? [...checkedAssetIds]
        : form.scope === "folder"
          ? [...folderAssetIds]
          : [...allAssetIds],
    task_profile: form.profile,
    task_rules: form.taskRules,
    intensity: form.strength,
    metadata_snapshot_at: Number.isFinite(parsedSnapshot)
      ? new Date(parsedSnapshot).toISOString()
      : null,
  };
}

export function buildScreeningItemQuery(filters: ScreeningFilterState): ScreeningItemQuery {
  return {
    pool: filters.pool,
    rating: filters.rating,
    flag: filters.flag,
    showDuplicates: filters.showDuplicates,
    sort: filters.sort,
  };
}

export const ACTIVE_SCREENING_STATUSES = new Set<ScreeningOperation["status"]>([
  "queued",
  "running",
  "stopping",
]);

export function screeningResultsReady(operation: ScreeningOperation | null): boolean {
  return Boolean(operation && !ACTIVE_SCREENING_STATUSES.has(operation.status));
}

export function reconcileSelectedScreeningOperationId(
  selectedOperationId: string | null,
  operations: readonly ScreeningOperation[],
): string | null {
  if (selectedOperationId && operations.some((operation) => operation.id === selectedOperationId)) {
    return selectedOperationId;
  }
  return (
    operations.find((operation) => ACTIVE_SCREENING_STATUSES.has(operation.status))?.id ??
    operations[0]?.id ??
    null
  );
}
