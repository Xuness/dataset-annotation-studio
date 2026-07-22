import { join, localDataDir } from "@tauri-apps/api/path";

const DEVELOPMENT_APP_DIRECTORY = "Dataset Studio";
const RELEASE_APP_DIRECTORY = "DatasetAnnotationStudio";

export async function resolveDesktopLogDirectory(developmentBuild: boolean): Promise<string> {
  const localData = await localDataDir();
  const applicationDirectory = developmentBuild ? DEVELOPMENT_APP_DIRECTORY : RELEASE_APP_DIRECTORY;
  return join(localData, applicationDirectory, "logs");
}
