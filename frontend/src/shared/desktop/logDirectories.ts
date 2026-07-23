import { join, localDataDir } from "@tauri-apps/api/path";

const APPLICATION_DIRECTORY = "DatasetAnnotationStudio";

export async function resolveDesktopLogDirectory(): Promise<string> {
  const localData = await localDataDir();
  return join(localData, APPLICATION_DIRECTORY, "logs");
}
