export function toggleFolderSelection(current: readonly string[], folderPath: string): string[] {
  if (!folderPath) return [];
  return current.includes(folderPath)
    ? current.filter((candidate) => candidate !== folderPath)
    : [...current, folderPath];
}

export function reconcileFolderSelection(
  current: readonly string[],
  available: readonly string[],
): string[] {
  const availablePaths = new Set(available);
  const seen = new Set<string>();
  return current.filter((folderPath) => {
    if (!availablePaths.has(folderPath) || seen.has(folderPath)) return false;
    seen.add(folderPath);
    return true;
  });
}

export function folderSelectionsEqual(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((folderPath, index) => folderPath === right[index])
  );
}
