export const THEME_IDS = ["silent-gallery", "sea-fog"] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  englishName: string;
  description: string;
  sceneImage: string;
  previewPosition: string;
  swatches: readonly [string, string, string, string];
  browserThemeColor: string;
}

export const DEFAULT_THEME_ID: ThemeId = "silent-gallery";

export const THEMES: readonly ThemeDefinition[] = [
  {
    id: "silent-gallery",
    name: "静默展厅",
    englishName: "Silent Gallery",
    description: "深海蓝黑、惨白文字与克制的暗红焦点，延续首页古堡展厅的幽暗秩序。",
    sceneImage: "/home/silent-gallery-hall.webp",
    previewPosition: "76% 46%",
    swatches: ["#02070b", "#0b151d", "#dce3e7", "#8f2a32"],
    browserThemeColor: "#02070b",
  },
  {
    id: "sea-fog",
    name: "海雾档案",
    englishName: "Sea Fog Archive",
    description: "更冷、更潮湿的蓝灰层次，让阴雨海岸成为首页与工作区边缘的远景。",
    sceneImage: "/home/silent-gallery-shore.webp",
    previewPosition: "62% 48%",
    swatches: ["#03080d", "#0b1821", "#d7e1e6", "#99404a"],
    browserThemeColor: "#03080d",
  },
] as const;

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEME_IDS.some((themeId) => themeId === value);
}

export function getThemeDefinition(themeId: ThemeId): ThemeDefinition {
  return THEMES.find((theme) => theme.id === themeId) ?? THEMES[0];
}
