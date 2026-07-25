export const tagDictionaryKeys = {
  all: ["tag-dictionaries"] as const,
  library: ["tag-dictionaries", "library"] as const,
  downloads: ["tag-dictionaries", "downloads"] as const,
  downloadTasks: ["tag-dictionaries", "downloads", "tasks"] as const,
  search: (query: string, language: string) =>
    ["tag-dictionaries", "search", query, language] as const,
  resolution: (tagsSignature: string, language: string) =>
    ["tag-dictionaries", "resolution", tagsSignature, language] as const,
};
