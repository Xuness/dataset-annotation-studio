import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

function style(name: string): string {
  const directory =
    name === "tokens.css"
      ? "src/v2/themes/dial-archive/styles"
      : "src/v2/themes/dial-archive/home/styles";
  return readFileSync(resolve(process.cwd(), directory, name), "utf8");
}

describe("dial archive source contracts", () => {
  test("keeps moving row visuals out of the stable pointer hit layer", () => {
    const indexStyles = style("index.css");
    expect(indexStyles).toMatch(
      /\.dial-archive-index__row-surface\s*\{[^}]*pointer-events:\s*none;/su,
    );
    expect(indexStyles).toMatch(
      /\.dial-archive-index__row:hover\s+\.dial-archive-index__row-surface/su,
    );
  });

  test("keeps theme keyframes and custom properties namespaced", () => {
    const styles = [
      style("tokens.css"),
      style("home.css"),
      style("index.css"),
      style("dial.css"),
      style("motion.css"),
      ...["space.css", "archive.css", "preparation.css", "workbench.css", "motion.css"].map(
        (name) =>
          readFileSync(
            resolve(process.cwd(), "src/v2/themes/dial-archive/spaces/styles", name),
            "utf8",
          ),
      ),
    ].join("\n");
    const keyframes = [...styles.matchAll(/@keyframes\s+([\w-]+)/gu)].map((match) => match[1]);
    const properties = [...styles.matchAll(/(--[\w-]+)\s*:/gu)].map((match) => match[1]);
    expect(keyframes.every((name) => name.startsWith("dial-archive-"))).toBe(true);
    expect(properties.every((name) => name.startsWith("--dial-archive-"))).toBe(true);
  });

  test("keeps text crisp and desktop window controls stable across canvas scales", () => {
    const homeStyles = style("home.css");
    const tokenStyles = style("tokens.css");
    const canvasRule = homeStyles.match(/\.dial-archive-home__canvas\s*\{[^}]*\}/su)?.[0];
    const controlRule = homeStyles.match(
      /\.dial-archive-chrome__window-controls button\s*\{[^}]*\}/su,
    )?.[0];
    expect(canvasRule).toMatch(/zoom:\s*var\(--dial-archive-canvas-scale\);/u);
    expect(canvasRule).not.toMatch(/scale\(var\(--dial-archive-canvas-scale\)\)/u);
    expect(homeStyles).toMatch(/text-rendering:\s*auto;/u);
    expect(tokenStyles).toMatch(/--dial-archive-window-control-width:\s*44px;/u);
    expect(tokenStyles).toMatch(/--dial-archive-window-icon-size:\s*14px;/u);
    expect(controlRule).toMatch(/width:\s*var\(--dial-archive-window-control-width\);/u);
    expect(controlRule).toMatch(/height:\s*100%;/u);
  });

  test("keeps secondary route traces below content and free of blur or segmented grids", () => {
    const spaceStyles = readFileSync(
      resolve(process.cwd(), "src/v2/themes/dial-archive/spaces/styles/space.css"),
      "utf8",
    );
    const handoffRule = spaceStyles.match(/\.dial-archive-space-handoff\s*\{[^}]*\}/su)?.[0];
    const routingRule = spaceStyles.match(
      /\.dial-archive-space__page\.is-routing\s*\{[^}]*\}/su,
    )?.[0];
    const cursorTickRule = spaceStyles.match(
      /\.dial-archive-space-rail__cursor::after\s*\{[^}]*\}/su,
    )?.[0];

    expect(handoffRule).toMatch(/z-index:\s*1;/u);
    expect(handoffRule).toMatch(/background:\s*var\(--dial-archive-yellow\);/u);
    expect(handoffRule).not.toMatch(/gradient/u);
    expect(routingRule).not.toMatch(/opacity|filter|blur/u);
    expect(cursorTickRule).toMatch(/right:\s*0;/u);
  });

  test("keeps preparation canvas geometry out of component and CSS mirrors", () => {
    const canvasSource = readFileSync(
      resolve(process.cwd(), "src/v2/themes/dial-archive/spaces/preparation/PreparationCanvas.tsx"),
      "utf8",
    );
    const workbenchStyles = readFileSync(
      resolve(process.cwd(), "src/v2/themes/dial-archive/spaces/styles/workbench.css"),
      "utf8",
    );

    expect(canvasSource).not.toMatch(/NODE_CENTERS|const SURFACE_(?:WIDTH|HEIGHT)/u);
    expect(canvasSource).toMatch(/createPreparationCanvasEdgePath/u);
    expect(workbenchStyles).not.toMatch(
      /\.dial-archive-preparation-node\.is-(?:source|scope|geometry|encoding|identity|preview|commit|recovery)\s*\{/u,
    );
    expect(workbenchStyles).not.toMatch(
      /\.dial-archive-preparation-minimap\s+\.is-(?:source|scope|geometry|encoding|identity|preview|commit|recovery)\s*\{/u,
    );
  });
});
