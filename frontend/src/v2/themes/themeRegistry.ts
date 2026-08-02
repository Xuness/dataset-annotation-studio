import { lazy, type ComponentType, type LazyExoticComponent } from "react";

import type { FrontendThemeModule, ThemeHomePageProps, ThemeSpacePageProps } from "./themeTypes";

export interface FrontendThemeDefinition {
  id: string;
  HomePage: LazyExoticComponent<FrontendThemeModule["HomePage"]>;
  SpacePage: LazyExoticComponent<FrontendThemeModule["SpacePage"]>;
}

export const DEFAULT_FRONTEND_THEME_ID = "dial-archive";

const themeModules = import.meta.glob<FrontendThemeModule>("./*/index.tsx");
const themePathPattern = /^\.\/([a-z0-9][a-z0-9-]*)\/index\.tsx$/u;

function lazyHomePage(loader: () => Promise<FrontendThemeModule>) {
  return lazy(async () => {
    const module = await loader();
    return { default: module.HomePage as ComponentType<ThemeHomePageProps> };
  });
}

function lazySpacePage(loader: () => Promise<FrontendThemeModule>) {
  return lazy(async () => {
    const module = await loader();
    return { default: module.SpacePage as ComponentType<ThemeSpacePageProps> };
  });
}

function buildThemeDefinitions(): readonly FrontendThemeDefinition[] {
  const definitions = Object.entries(themeModules).map(([path, loader]) => {
    const match = themePathPattern.exec(path);
    if (!match) throw new Error(`Invalid frontend theme path: ${path}`);
    return {
      id: match[1],
      HomePage: lazyHomePage(loader),
      SpacePage: lazySpacePage(loader),
    };
  });

  definitions.sort((left, right) => left.id.localeCompare(right.id));
  const ids = definitions.map((definition) => definition.id);
  if (new Set(ids).size !== ids.length) throw new Error("Frontend theme IDs must be unique.");
  if (!ids.includes(DEFAULT_FRONTEND_THEME_ID)) {
    throw new Error(`Default frontend theme "${DEFAULT_FRONTEND_THEME_ID}" is not registered.`);
  }
  return Object.freeze(definitions);
}

export const FRONTEND_THEMES = buildThemeDefinitions();
export const FRONTEND_THEME_IDS = Object.freeze(FRONTEND_THEMES.map((theme) => theme.id));

export function resolveFrontendThemeId(search: string): string {
  const parameters = new URLSearchParams(search);
  const requestedId = parameters.get("theme") ?? parameters.get("home");
  return requestedId && FRONTEND_THEME_IDS.includes(requestedId)
    ? requestedId
    : DEFAULT_FRONTEND_THEME_ID;
}

export function getFrontendTheme(id: string): FrontendThemeDefinition {
  const theme = FRONTEND_THEMES.find((candidate) => candidate.id === id);
  if (!theme) throw new Error(`Unknown frontend theme: ${id}`);
  return theme;
}
