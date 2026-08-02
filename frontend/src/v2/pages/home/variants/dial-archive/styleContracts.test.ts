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
});
