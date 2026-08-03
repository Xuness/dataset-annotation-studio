import { HOME_SPACES, type HomeSpace, type HomeSpaceId } from "../navigation/spaceRegistry";

const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

interface FrontendHrefOptions {
  themeId: string;
  projectId?: string | null;
  initialSpace?: HomeSpace;
}

function normalizeProjectId(projectId: string | null | undefined): string | null {
  const normalized = projectId?.trim() ?? "";
  return PROJECT_ID_PATTERN.test(normalized) ? normalized : null;
}

export function readInitialHomeSpaceId(search: string): HomeSpaceId | undefined {
  const requested = Number.parseInt(new URLSearchParams(search).get("s") ?? "", 10);
  if (!Number.isInteger(requested) || requested < 1 || requested > HOME_SPACES.length) {
    return undefined;
  }
  return HOME_SPACES[requested - 1].id;
}

export function readProjectId(search: string): string | null {
  return normalizeProjectId(new URLSearchParams(search).get("project"));
}

export function buildFrontendHref(
  path: string,
  { themeId, projectId, initialSpace }: FrontendHrefOptions,
): string {
  const parameters = new URLSearchParams({ theme: themeId });
  const normalizedProjectId = normalizeProjectId(projectId);
  if (normalizedProjectId) parameters.set("project", normalizedProjectId);
  if (initialSpace) parameters.set("s", String(Number.parseInt(initialSpace.index, 10)));
  return `${path}?${parameters.toString()}`;
}

export function replaceProjectIdInHref(
  pathname: string,
  search: string,
  projectId: string | null,
): string {
  const parameters = new URLSearchParams(search);
  const normalizedProjectId = normalizeProjectId(projectId);
  if (normalizedProjectId) parameters.set("project", normalizedProjectId);
  else parameters.delete("project");
  const query = parameters.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}
