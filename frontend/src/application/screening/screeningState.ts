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

export const SCREENING_THUMBNAIL_SIZE_MIN = 160;
export const SCREENING_THUMBNAIL_SIZE_MAX = 400;
export const SCREENING_THUMBNAIL_SIZE_STEP = 40;
export const SCREENING_THUMBNAIL_SIZE_DEFAULT = 240;

export function clampScreeningThumbnailSize(size: number): number {
  if (!Number.isFinite(size)) return SCREENING_THUMBNAIL_SIZE_DEFAULT;
  const stepped = Math.round(size / SCREENING_THUMBNAIL_SIZE_STEP) * SCREENING_THUMBNAIL_SIZE_STEP;
  return Math.min(SCREENING_THUMBNAIL_SIZE_MAX, Math.max(SCREENING_THUMBNAIL_SIZE_MIN, stepped));
}

export function adjustScreeningThumbnailSize(size: number, direction: -1 | 1): number {
  return clampScreeningThumbnailSize(size + direction * SCREENING_THUMBNAIL_SIZE_STEP);
}

export function shouldCheckScreeningResult(
  resultAssetIds: readonly string[],
  checkedAssetIds: readonly string[],
): boolean {
  if (!resultAssetIds.length) return false;
  const checked = new Set(checkedAssetIds);
  return resultAssetIds.some((assetId) => !checked.has(assetId));
}

export function checkedScreeningResultIds(
  resultAssetIds: readonly string[],
  checkedAssetIds: readonly string[],
): string[] {
  const checked = new Set(checkedAssetIds);
  return resultAssetIds.filter((assetId) => checked.has(assetId));
}

export function buildScreeningCandidateHandoffQuery(showDuplicates: boolean): ScreeningItemQuery {
  return {
    pool: null,
    rating: null,
    flag: null,
    showDuplicates,
  };
}

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
  galleryThumbnailSize: number;
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
  galleryThumbnailSize: SCREENING_THUMBNAIL_SIZE_DEFAULT,
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
