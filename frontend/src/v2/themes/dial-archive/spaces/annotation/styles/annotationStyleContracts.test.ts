import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const STYLE_DIRECTORY = "src/v2/themes/dial-archive/spaces/annotation/styles";

function style(name: string): string {
  return readFileSync(resolve(process.cwd(), STYLE_DIRECTORY, name), "utf8");
}

describe("annotation stage visual contracts", () => {
  test("loads the shared legibility floor after feature geometry", () => {
    const entry = style("annotation-stage.css");
    const imports = [...entry.matchAll(/@import\s+"\.\/([^"]+)";/gu)].map((match) => match[1]);

    expect(imports.at(-1)).toBe("annotation-stage-legibility.css");
  });

  test("keeps functional copy readable and the specimen on a light calibration bed", () => {
    const legibility = style("annotation-stage-legibility.css");
    const specimenRule = legibility.match(
      /\.dial-archive-stage-specimen__frame\s*\{[^}]*\}/su,
    )?.[0];

    expect(legibility).toMatch(/--dial-archive-annotation-type-meta:\s*10px;/u);
    expect(legibility).toMatch(/--dial-archive-annotation-type-label:\s*11px;/u);
    expect(legibility).toMatch(/--dial-archive-annotation-type-body:\s*12px;/u);
    expect(specimenRule).toMatch(/#eceeea/u);
    expect(specimenRule).not.toMatch(/background[^;]*#(?:000|191919)/u);
  });

  test("finishes workcell content motion inside its React transition state", () => {
    const viewport = style("annotation-workcell-viewport.css");
    const reconstruction = style("annotation-stage-reconstruction.css");

    expect(reconstruction).toMatch(
      /\.dial-archive-workcell-viewport\.is-opening\s+\.dial-archive-workcell-viewport__plane\s*\{[^}]*var\(--dial-archive-stage-workcell-open-duration\)/su,
    );
    expect(reconstruction).toMatch(
      /\.dial-archive-workcell-viewport\.is-switching\s+\.dial-archive-workcell-viewport__plane\s*\{[^}]*var\(--dial-archive-stage-workcell-switch-duration\)/su,
    );
    expect(viewport).toMatch(
      /\.is-opening\s+\.dial-archive-workcell-viewport__body\s*\{[^}]*450ms[^}]*120ms/su,
    );
    expect(viewport).toMatch(
      /\.is-switching\s+\.dial-archive-workcell-viewport__body\s*\{[^}]*280ms[^}]*20ms/su,
    );
  });

  test("reserves stable reading space for film, dossier, and production inspectors", () => {
    const legibility = style("annotation-stage-legibility.css");
    const translation = style("annotation-workcell-edit-translation.css");

    expect(legibility).toMatch(/\.dial-archive-stage-filmstrip__track-viewport\s*\{/u);
    expect(legibility).toMatch(
      /\.dial-archive-stage\[data-workcell="edit"\]\s*\{[^}]*--dial-archive-stage-edit-film-height:\s*clamp\(112px,\s*9vh,\s*128px\);/su,
    );
    expect(legibility).toMatch(
      /:is\(\s*\.dial-archive-stage-filmstrip__track,\s*\.dial-archive-stage-filmstrip__rail,\s*\.dial-archive-stage-filmstrip__progress\s*\)\s*\{[^}]*display:\s*block;/su,
    );
    expect(translation).toMatch(
      /\.dial-archive-edit-translation__aligned\.is-segment\s*\{[^}]*white-space:\s*pre-wrap;/su,
    );
    expect(legibility).toMatch(
      /\.dial-archive-stage\s+\.dial-archive-dossier-register\s*\{[^}]*bottom:\s*0;/su,
    );
    expect(legibility).toMatch(
      /\.dial-archive-stage\s+\.dial-archive-dossier-register__foot\s*\{[^}]*margin:\s*0;/su,
    );
    expect(legibility).toMatch(
      /\.dial-archive-production-input-nav\s+b\s*\{[^}]*display:\s*block;/su,
    );
    expect(legibility).toMatch(
      /\.dial-archive-context-surface\.is-inspector\s+textarea\s*\{[^}]*height:\s*58px;/su,
    );
    expect(legibility).toMatch(/\.dial-archive-production-commit__overview\s*>\s*span/u);
    expect(legibility).toMatch(
      /\.dial-archive-production-workcell__console-field\.dial-archive-preparation-inspector\s*\{[^}]*--dial-archive-annotation-type-meta:\s*clamp\(12px,/su,
    );
    expect(legibility).toMatch(/width:\s*clamp\(560px,\s*32vw,\s*900px\);/u);
    expect(legibility).not.toMatch(
      /\.dial-archive-production-lane:not\(\.is-active\)[^{]*\{[^}]*visibility:\s*hidden;/su,
    );
  });
});
