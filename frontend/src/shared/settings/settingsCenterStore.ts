import { create } from "zustand";

export type SettingsSection = "themes";

interface SettingsCenterState {
  isOpen: boolean;
  section: SettingsSection;
  open: (section?: SettingsSection) => void;
  close: () => void;
}

export const useSettingsCenter = create<SettingsCenterState>((set) => ({
  isOpen: false,
  section: "themes",
  open: (section = "themes") => set({ isOpen: true, section }),
  close: () => set({ isOpen: false }),
}));
