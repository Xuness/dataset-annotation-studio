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

export type ThemeMaterialId = "paper" | "glass" | "wet-glass";

export interface ThemeMaterialDefinition {
  id: ThemeMaterialId;
  workspaceSurfaceOpacity: number;
}

interface ThemeDefinitionShape {
  id: string;
  name: string;
  englishName: string;
  description: string;
  nativeWindowTheme: "light" | "dark";
  material: ThemeMaterialDefinition;
  scene: ThemeSceneDefinition;
  swatches: readonly [string, string, string, string];
  browserThemeColor: string;
}

function defineThemes<const Themes extends readonly ThemeDefinitionShape[]>(themes: Themes) {
  return themes;
}

export const THEMES = defineThemes([
  {
    id: "warm-paper",
    name: "暖纸手札",
    englishName: "Warm Paper",
    description: "回到项目最初的暖纸、陶土玫瑰与鼠尾草配色，让长时间整理与标注更柔和。",
    nativeWindowTheme: "light",
    material: { id: "paper", workspaceSurfaceOpacity: 0.97 },
    scene: {
      image: "/home/warm-paper-still-life.svg",
      previewPosition: "72% 48%",
      home: {
        position: "center",
        size: "cover",
        filter: "saturate(0.88) contrast(0.98)",
        opacity: 0.82,
        blurPx: 0,
      },
      workspace: {
        position: "72% 50%",
        size: "cover",
        filter: "saturate(0.76) contrast(0.96)",
        opacity: 0.055,
        blurPx: 0,
      },
    },
    swatches: ["#f5f1ea", "#fbfaf7", "#302d2a", "#b77f73"],
    browserThemeColor: "#f5f1ea",
  },
  {
    id: "silent-gallery",
    name: "静默展厅",
    englishName: "Silent Gallery",
    description: "炭黑、铅灰与旧纸般的惨白，只留一道暗红信号，延续首页展厅的幽暗秩序。",
    nativeWindowTheme: "dark",
    material: { id: "glass", workspaceSurfaceOpacity: 0.97 },
    scene: {
      image: "/home/silent-gallery-hall.webp",
      previewPosition: "76% 46%",
      home: {
        position: "center",
        size: "cover",
        filter: "saturate(0.42) contrast(1.07) brightness(0.52)",
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
    name: "雨白哥特",
    englishName: "Rainveil Gothic",
    description: "雾白天光、湿石与冷绿植被沉入雾幕，只让哥特墨色和旧玫瑰留下微弱信号。",
    nativeWindowTheme: "light",
    material: { id: "wet-glass", workspaceSurfaceOpacity: 0.74 },
    scene: {
      image: "/home/rainveil-gothic-example.png",
      previewPosition: "63% 50%",
      home: {
        position: "63% 50%",
        size: "auto 168%",
        filter: "saturate(0.42) contrast(0.82) brightness(1.16)",
        opacity: 0.62,
        blurPx: 0,
      },
      workspace: {
        position: "66% 50%",
        size: "auto 168%",
        filter: "grayscale(0.28) saturate(0.42) contrast(0.82) brightness(1.12)",
        opacity: 0.32,
        blurPx: 0,
      },
    },
    swatches: ["#e9edf0", "#aebbc3", "#20262b", "#9b5367"],
    browserThemeColor: "#ccd5db",
  },
] as const);

export type ThemeDefinition = (typeof THEMES)[number];
export type ThemeId = ThemeDefinition["id"];

export const DEFAULT_THEME_ID = "silent-gallery" satisfies ThemeId;

const defaultTheme: ThemeDefinition = (() => {
  const theme = THEMES.find((candidate) => candidate.id === DEFAULT_THEME_ID);
  if (!theme) throw new Error(`Default theme definition is missing: ${DEFAULT_THEME_ID}`);
  return theme;
})();

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEMES.some((theme) => theme.id === value);
}

export function getThemeDefinition(themeId: ThemeId): ThemeDefinition {
  return THEMES.find((theme) => theme.id === themeId) ?? defaultTheme;
}
