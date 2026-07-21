import { create } from "zustand";

import { DEFAULT_THEME_ID, getThemeDefinition, isThemeId, type ThemeId } from "./themes";

const STORAGE_KEY = "dataset-studio.preferences";
const PREFERENCES_VERSION = 1;

interface PersistedPreferences {
  version: typeof PREFERENCES_VERSION;
  themeId: ThemeId;
}

interface AppPreferencesState {
  themeId: ThemeId;
  setTheme: (themeId: ThemeId) => void;
}

const DEFAULT_PREFERENCES: PersistedPreferences = {
  version: PREFERENCES_VERSION,
  themeId: DEFAULT_THEME_ID,
};

function readStoredPreferences(): PersistedPreferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const value = JSON.parse(raw) as Partial<PersistedPreferences>;
    if (value.version !== PREFERENCES_VERSION || !isThemeId(value.themeId)) {
      return DEFAULT_PREFERENCES;
    }
    return { version: PREFERENCES_VERSION, themeId: value.themeId };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function persistPreferences(themeId: ThemeId) {
  if (typeof window === "undefined") return;
  const preferences: PersistedPreferences = { version: PREFERENCES_VERSION, themeId };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Theme switching should remain available when browser storage is unavailable.
  }
}

export function applyTheme(themeId: ThemeId) {
  if (typeof document === "undefined") return;
  const theme = getThemeDefinition(themeId);
  document.documentElement.dataset.theme = theme.id;
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", theme.browserThemeColor);
}

const initialPreferences = readStoredPreferences();

export const useAppPreferences = create<AppPreferencesState>((set) => ({
  themeId: initialPreferences.themeId,
  setTheme: (themeId) => {
    persistPreferences(themeId);
    applyTheme(themeId);
    set({ themeId });
  },
}));

export function initializeAppPreferences() {
  applyTheme(useAppPreferences.getState().themeId);
}
