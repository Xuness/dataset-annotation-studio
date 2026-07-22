import { create } from "zustand";

import { DEFAULT_SETTINGS_SECTION, type SettingsSection } from "./settingsSectionIds";

interface SettingsCenterState {
  isOpen: boolean;
  section: SettingsSection;
  open: (section?: SettingsSection) => void;
  close: () => void;
}

export const useSettingsCenter = create<SettingsCenterState>((set) => ({
  isOpen: false,
  section: DEFAULT_SETTINGS_SECTION,
  open: (section = DEFAULT_SETTINGS_SECTION) => set({ isOpen: true, section }),
  close: () => set({ isOpen: false }),
}));
