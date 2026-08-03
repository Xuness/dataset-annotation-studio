import { HOME_SPACES, type HomeSpace, type HomeSpaceId } from "../navigation/spaceRegistry";

const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

interface FrontendHrefOptions {
  themeId: string;
  projectId?: string | null;
  initialSpace?: HomeSpace;
  query?: Readonly<Record<string, string | null | undefined>>;
}

const RESERVED_QUERY_KEYS = new Set(["theme", "project", "s"]);

function normalizeRouteIdentifier(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
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
  return normalizeRouteIdentifier(new URLSearchParams(search).get("project"));
}

export function readRouteIdentifier(search: string, key: string): string | null {
  if (RESERVED_QUERY_KEYS.has(key)) return null;
  return normalizeRouteIdentifier(new URLSearchParams(search).get(key));
}

export function buildFrontendHref(
  path: string,
  { themeId, projectId, initialSpace, query }: FrontendHrefOptions,
): string {
  const parameters = new URLSearchParams({ theme: themeId });
  const normalizedProjectId = normalizeRouteIdentifier(projectId);
  if (normalizedProjectId) parameters.set("project", normalizedProjectId);
  if (initialSpace) parameters.set("s", String(Number.parseInt(initialSpace.index, 10)));
  for (const [key, value] of Object.entries(query ?? {})) {
    if (RESERVED_QUERY_KEYS.has(key)) continue;
    const normalizedValue = normalizeRouteIdentifier(value);
    if (normalizedValue) parameters.set(key, normalizedValue);
  }
  return `${path}?${parameters.toString()}`;
}

export function replaceProjectIdInHref(
  pathname: string,
  search: string,
  projectId: string | null,
): string {
  const parameters = new URLSearchParams(search);
  const normalizedProjectId = normalizeRouteIdentifier(projectId);
  if (normalizedProjectId) parameters.set("project", normalizedProjectId);
  else parameters.delete("project");
  const query = parameters.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}
