export function providerCredentialCacheToken(apiKey: string | null | undefined): string {
  if (!apiKey) return "absent";
  let hash = 2166136261;
  for (let index = 0; index < apiKey.length; index += 1) {
    hash ^= apiKey.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `present:${apiKey.length}:${(hash >>> 0).toString(16)}`;
}
