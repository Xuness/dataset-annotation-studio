import { Suspense } from "react";

import { getHomeVariant, resolveHomeVariantId } from "./homeVariantRegistry";

export function HomeVariantHost() {
  const search = typeof window === "undefined" ? "" : window.location.search;
  const variantId = resolveHomeVariantId(search);
  const { Component } = getHomeVariant(variantId);

  return (
    <div className="frontend-home-variant-host" data-home-variant={variantId}>
      <Suspense fallback={<div className="frontend-home-variant-loading">LOADING INTERFACE</div>}>
        <Component />
      </Suspense>
    </div>
  );
}
