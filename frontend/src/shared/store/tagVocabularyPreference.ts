const AUTO_VOCABULARY = "auto";
const VOCABULARY_STORAGE_PREFIX = "dataset-studio.tag-vocabulary-source";

function vocabularyStorageKey(projectId: string): string {
  return `${VOCABULARY_STORAGE_PREFIX}.${projectId}`;
}

export function readTagVocabularyPreference(projectId: string): string {
  return window.localStorage.getItem(vocabularyStorageKey(projectId)) || AUTO_VOCABULARY;
}

export function writeTagVocabularyPreference(projectId: string, value: string): void {
  window.localStorage.setItem(vocabularyStorageKey(projectId), value);
}
