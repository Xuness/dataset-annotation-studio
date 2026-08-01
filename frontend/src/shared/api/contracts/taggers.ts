import type { ApiOutput, ApiSchema } from "../schema";

export type TaggerInstallationStatus = ApiSchema<"TaggerInstallationStatus">;
export type TaggerDevice = ApiSchema<"TaggerDevice">;
export type TaggerSelectionMode = ApiSchema<"TaggerSelectionMode">;
export type TaggerSelectionPolicy = ApiOutput<"TaggerSelectionPolicy">;
export type TaggerProfileCapabilities = ApiOutput<"TaggerProfileCapabilities">;
export type TaggerFileRecord = ApiOutput<"TaggerFileRecord">;
export type TaggerInstallation = ApiOutput<"TaggerInstallation">;
export type TaggerProfile = ApiOutput<"TaggerProfile">;
export type TaggerProfileInput = Pick<
  ApiOutput<"TaggerProfileCreate">,
  "name" | "installation_id" | "selection" | "categories" | "device" | "batch_size"
>;
export type TaggerLibrary = ApiOutput<"TaggerLibrary">;
export type TaggerVocabularyItem = ApiOutput<"TaggerVocabularyItem">;
export type TaggerVocabularySearchResult = ApiOutput<"TaggerVocabularySearchResult">;
export type TaggerDownloadStatus = ApiSchema<"TaggerDownloadStatus">;
export type HuggingFaceProxyMode = ApiSchema<"HuggingFaceProxyMode">;
export type HuggingFaceTokenSource = ApiOutput<"HuggingFaceConnectionSettings">["token_source"];
export type TaggerDownloadOffer = ApiOutput<"TaggerDownloadOffer">;
export type TaggerDownloadTask = ApiOutput<"TaggerDownloadTask">;
export type HuggingFaceConnectionSettings = ApiOutput<"HuggingFaceConnectionSettings">;
type GeneratedHuggingFaceSettingsUpdate = ApiSchema<"HuggingFaceSettingsUpdate">;
export type HuggingFaceSettingsUpdate = Omit<
  GeneratedHuggingFaceSettingsUpdate,
  "clear_proxy" | "clear_token"
> &
  Partial<Pick<GeneratedHuggingFaceSettingsUpdate, "clear_proxy" | "clear_token">>;
export type HuggingFaceConnectionTest = ApiOutput<"HuggingFaceConnectionTest">;
export type TaggerDownloadCenter = ApiOutput<"TaggerDownloadCenter">;
