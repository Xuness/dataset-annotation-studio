export const SETTINGS_SECTION_IDS = ["appearance", "presets", "about"] as const;

export type SettingsSection = (typeof SETTINGS_SECTION_IDS)[number];

export const DEFAULT_SETTINGS_SECTION = "appearance" satisfies SettingsSection;
