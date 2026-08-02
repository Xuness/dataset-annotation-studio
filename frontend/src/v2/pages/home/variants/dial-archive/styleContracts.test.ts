import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

function style(name: string): string {
  return readFileSync(
    resolve(process.cwd(), "src/v2/pages/home/variants/dial-archive/styles", name),
    "utf8",
  );
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
    const styles = ["tokens.css", "home.css", "index.css", "dial.css", "motion.css"]
      .map(style)
      .join("\n");
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
});
