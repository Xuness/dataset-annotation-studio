import { create } from "zustand";

export type SettingsSection = "appearance";

interface SettingsCenterState {
  isOpen: boolean;
  section: SettingsSection;
  open: (section?: SettingsSection) => void;
  close: () => void;
}

export const useSettingsCenter = create<SettingsCenterState>((set) => ({
  isOpen: false,
  section: "appearance",
  open: (section = "appearance") => set({ isOpen: true, section }),
  close: () => set({ isOpen: false }),
}));
