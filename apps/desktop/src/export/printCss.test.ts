import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  path.resolve(import.meta.dirname, "PrintDocument.module.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//gu, "");

/** Declarations of the first top-level rule whose selector is exactly `selector`. */
function topLevelRule(selector: string): string {
  const withoutMedia = css.replace(
    /@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/gu,
    "",
  );
  const m = new RegExp(
    `(?:^|\\})\\s*${selector.replace(/[[\]]/gu, "\\$&")}\\s*\\{([^}]*)\\}`,
    "u",
  ).exec(withoutMedia);
  if (!m) throw new Error(`rule ${selector} not found`);
  return m[1] as string;
}

function mediaPrint(): string {
  const start = css.indexOf("@media print");
  expect(start).toBeGreaterThan(-1);
  return css.slice(start);
}

describe("PrintDocument.module.css", () => {
  const screen = topLevelRule("[data-print-root]");

  it("lays the print root out off-screen on screen, never hidden", () => {
    expect(screen).not.toMatch(/display\s*:\s*none/u);
    expect(screen).not.toMatch(/visibility\s*:\s*hidden/u);
    expect(screen).toMatch(/position\s*:\s*fixed/u);
    expect(screen).toMatch(/inset-block-start\s*:\s*0/u);
    expect(screen).toMatch(/inset-inline-start\s*:\s*-10000px/u);
  });

  it("sizes the print root to the A4 printable width (210 - 2 x 15 mm)", () => {
    expect(screen).toMatch(/inline-size\s*:\s*180mm/u);
  });

  it("declares A4 with 15 mm margins", () => {
    expect(css).toMatch(/@page\s*\{[^}]*size\s*:\s*a4[^}]*margin\s*:\s*15mm/iu);
  });

  it("hides #root only while an export prints and shows the print root statically", () => {
    const print = mediaPrint();
    expect(print).toMatch(
      /:root\[data-printing="export"\]\s+:global\(#root\)\s*\{[^}]*display\s*:\s*none\s*!important/u,
    );
    expect(print).toMatch(
      /:root\[data-printing="export"\]\s+\[data-print-root\]\s*\{[^}]*position\s*:\s*static/u,
    );
  });

  it("breaks pages between songs and after the cover, keeps headers with their song", () => {
    const print = mediaPrint();
    expect(print).toMatch(
      /\[data-print-song\]\s*\+\s*\[data-print-song\][^{]*\{[^}]*break-before\s*:\s*page/u,
    );
    expect(print).toMatch(
      /\[data-print-cover\]\s*\+\s*\[data-print-song\][^{]*\{[^}]*break-before\s*:\s*page/u,
    );
    expect(print).toMatch(
      /\[data-print-header\]\s*\{[^}]*break-after\s*:\s*avoid/u,
    );
  });

  it("uses no physical left/right properties", () => {
    expect(css).not.toMatch(
      /(^|[\s;{])(left|right|margin-left|margin-right|padding-left|padding-right)\s*:/u,
    );
  });
});
