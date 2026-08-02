import { lazy, type ComponentType, type LazyExoticComponent } from "react";

interface HomeVariantModule {
  default: ComponentType;
}

export interface HomeVariantDefinition {
  id: string;
  Component: LazyExoticComponent<ComponentType>;
}

export const DEFAULT_HOME_VARIANT_ID = "dial-archive";

const variantModules = import.meta.glob<HomeVariantModule>("./variants/*/index.tsx");
const variantPathPattern = /^\.\/variants\/([a-z0-9][a-z0-9-]*)\/index\.tsx$/u;

function buildVariantDefinitions(): readonly HomeVariantDefinition[] {
  const definitions = Object.entries(variantModules).map(([path, loader]) => {
    const match = variantPathPattern.exec(path);
    if (!match) throw new Error(`Invalid home variant path: ${path}`);
    return { id: match[1], Component: lazy(loader) };
  });

  definitions.sort((left, right) => left.id.localeCompare(right.id));
  const ids = definitions.map((definition) => definition.id);
  if (new Set(ids).size !== ids.length) throw new Error("Home variant IDs must be unique.");
  if (!ids.includes(DEFAULT_HOME_VARIANT_ID)) {
    throw new Error(`Default home variant "${DEFAULT_HOME_VARIANT_ID}" is not registered.`);
  }
  return Object.freeze(definitions);
}

export const HOME_VARIANTS = buildVariantDefinitions();
export const HOME_VARIANT_IDS = Object.freeze(HOME_VARIANTS.map((variant) => variant.id));

export function resolveHomeVariantId(search: string): string {
  const requestedId = new URLSearchParams(search).get("home");
  return requestedId && HOME_VARIANT_IDS.includes(requestedId)
    ? requestedId
    : DEFAULT_HOME_VARIANT_ID;
}

export function getHomeVariant(id: string): HomeVariantDefinition {
  const variant = HOME_VARIANTS.find((candidate) => candidate.id === id);
  if (!variant) throw new Error(`Unknown home variant: ${id}`);
  return variant;
}
