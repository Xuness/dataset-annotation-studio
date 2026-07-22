export const PRESET_TABS = ["system", "translation", "providers"] as const;

export type PresetTab = (typeof PRESET_TABS)[number];

export function resolvePresetTab(value: string | null): PresetTab {
  return value === "translation" || value === "providers" ? value : "system";
}

export function buildPresetLibraryPath(tab: PresetTab, create = false): string {
  const search = new URLSearchParams({ tab });
  if (create) search.set("action", "create");
  return `/presets?${search.toString()}`;
}
