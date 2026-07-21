export const THEME_IDS = ["silent-gallery", "sea-fog"] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export interface ThemeSceneSurface {
  position: string;
  size: string;
  filter: string;
  opacity: number;
  blurPx: number;
}

export interface ThemeSceneDefinition {
  image: string;
  previewPosition: string;
  home: ThemeSceneSurface;
  workspace: ThemeSceneSurface;
}

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  englishName: string;
  description: string;
  scene: ThemeSceneDefinition;
  swatches: readonly [string, string, string, string];
  browserThemeColor: string;
}

export const DEFAULT_THEME_ID: ThemeId = "silent-gallery";

export const THEMES: readonly ThemeDefinition[] = [
  {
    id: "silent-gallery",
    name: "静默展厅",
    englishName: "Silent Gallery",
    description: "炭黑、铅灰与旧纸般的惨白，只留一道暗红信号，延续首页展厅的幽暗秩序。",
    scene: {
      image: "/home/silent-gallery-hall.webp",
      previewPosition: "76% 46%",
      home: {
        position: "88% 46%",
        size: "auto 150%",
        filter: "saturate(0.52) contrast(1.05) brightness(0.62)",
        opacity: 0.78,
        blurPx: 0,
      },
      workspace: {
        position: "100% 48%",
        size: "auto 165%",
        filter: "grayscale(0.48) saturate(0.32) contrast(1.08) brightness(0.5)",
        opacity: 0.055,
        blurPx: 0,
      },
    },
    swatches: ["#050607", "#0c0e0f", "#d8d5cf", "#74232a"],
    browserThemeColor: "#02070b",
  },
  {
    id: "sea-fog",
    name: "海雾档案",
    englishName: "Sea Fog Archive",
    description: "更冷、更潮湿的海雾蓝灰，让阴雨海岸退到工作区边缘，信息仍保持安静。",
    scene: {
      image: "/home/silent-gallery-shore.webp",
      previewPosition: "62% 48%",
      home: {
        position: "65% 48%",
        size: "auto 150%",
        filter: "saturate(0.46) contrast(1.08) brightness(0.58)",
        opacity: 0.78,
        blurPx: 0,
      },
      workspace: {
        position: "100% 52%",
        size: "auto 165%",
        filter: "grayscale(0.48) saturate(0.32) contrast(1.08) brightness(0.5)",
        opacity: 0.065,
        blurPx: 0,
      },
    },
    swatches: ["#05090b", "#0b1113", "#d5d7d3", "#793039"],
    browserThemeColor: "#03080d",
  },
] as const;

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEME_IDS.some((themeId) => themeId === value);
}

export function getThemeDefinition(themeId: ThemeId): ThemeDefinition {
  return THEMES.find((theme) => theme.id === themeId) ?? THEMES[0];
}
