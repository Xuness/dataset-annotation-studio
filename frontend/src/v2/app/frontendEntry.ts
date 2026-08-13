const NEW_FRONTEND_QUERY_KEYS = ["theme", "home"] as const;

export function shouldLoadNewFrontend(search: string): boolean {
  const parameters = new URLSearchParams(search);
  return NEW_FRONTEND_QUERY_KEYS.some((key) => parameters.has(key));
}
