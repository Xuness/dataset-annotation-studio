import type { ComponentType } from "react";
import { Palette, type LucideIcon } from "lucide-react";

import { AppearanceSettings } from "./sections/AppearanceSettings";
import { type SettingsSection, SETTINGS_SECTION_IDS } from "./settingsSectionIds";

interface SettingsSectionDefinition {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  component: ComponentType<{ onClose: () => void }>;
}

const sectionDefinitions = {
  appearance: {
    id: "appearance",
    label: "外观与主题",
    icon: Palette,
    component: AppearanceSettings,
  },
} satisfies Record<SettingsSection, SettingsSectionDefinition>;

export const SETTINGS_SECTIONS = SETTINGS_SECTION_IDS.map((id) => sectionDefinitions[id]);
