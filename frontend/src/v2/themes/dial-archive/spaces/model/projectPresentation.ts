import type { ArchiveProjectRecord } from "../../../../pages/spaces/spacePageModel";

const countFormatter = new Intl.NumberFormat("en-US", { minimumIntegerDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const shortDateFormatter = new Intl.DateTimeFormat("en-CA", {
  month: "2-digit",
  day: "2-digit",
});

export interface ArchiveProjectPresentation {
  state: string;
  stateKind: "ready" | "loaded" | "alert";
  assetCount: string;
  annotatedCount: string;
  invalidCount: string;
  updatedAt: string;
  updatedShort: string;
}

function validDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatProjectSerial(value: number): string {
  return String(value).padStart(2, "0");
}

export function presentArchiveProject(
  project: ArchiveProjectRecord,
  activeProjectId: string | null,
): ArchiveProjectPresentation {
  const updated = validDate(project.lastOpenedAt ?? project.createdAt);
  const active = project.id === activeProjectId;
  const stateKind =
    !project.exists || project.invalidCount > 0 ? "alert" : active ? "loaded" : "ready";
  const state = !project.exists
    ? "PATH MISSING"
    : project.invalidCount > 0
      ? `CHECK · ${project.invalidCount}`
      : active
        ? "LOADED"
        : "READY";

  return {
    state,
    stateKind,
    assetCount: countFormatter.format(project.assetCount),
    annotatedCount: countFormatter.format(project.annotatedCount),
    invalidCount: countFormatter.format(project.invalidCount),
    updatedAt: updated ? dateFormatter.format(updated) : "—",
    updatedShort: updated ? shortDateFormatter.format(updated) : "—",
  };
}
