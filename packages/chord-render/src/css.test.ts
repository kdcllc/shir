import { describe, expect, it } from "vitest";

interface FsLike {
  readFileSync(path: URL, encoding: "utf8"): string;
}
// Vite intercepts CSS imports, so read the sources through Node's fs instead.
const proc = (
  globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }
).process;
const fs = proc?.getBuiltinModule?.("node:fs") as FsLike;
const read = (f: string) =>
  fs.readFileSync(new URL(f, import.meta.url), "utf8");

describe("CSS contract", () => {
  it("fonts.css is self-hosted", () => {
    const css = read("./fonts.css");
    expect(css).not.toMatch(/https?:\/\//);
    expect((css.match(/@import/g) ?? []).length).toBe(7);
  });
  it("lyrics use Noto Sans Hebrew first, chords JetBrains Mono", () => {
    expect(read("./SongView.module.css")).toMatch(
      /font-family:\s*"Noto Sans Hebrew",\s*heebo,\s*sans-serif/,
    );
    expect(read("./ChordLine.module.css")).toMatch(
      /font-family:\s*"JetBrains Mono",\s*monospace/,
    );
  });
  it("print CSS hides chrome and avoids breaks", () => {
    const css = read("./SongView.module.css");
    expect(css).toMatch(/@media print/);
    expect(css).toMatch(
      /@media print\s*{(?:[^{}]|{[^{}]*})*:global\(\[data-ui-chrome\]\)\s*{\s*display:\s*none\s*!important;/,
    );
    expect(css).toMatch(/break-inside:\s*avoid/);
  });
  it("chord box is the only positioned chord element", () => {
    const css = read("./ChordLine.module.css");
    expect(css).toMatch(
      /\.box\s*{[^}]*position:\s*absolute[^}]*inset-block-end:\s*100%[^}]*inset-inline-start:\s*0/,
    );
  });
});
