// G2 contract: docs/CHORDPRO.md must not drift from the chord-core model and API.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const read = (rel: string): string =>
  readFileSync(path.join(repoRoot, rel), "utf8");

const DOC = read("docs/CHORDPRO.md");
const MODEL = read("packages/chord-core/src/model.ts");

function lineKindsFromModel(src: string): string[] {
  const m = /export const LINE_KINDS = \[([\s\S]*?)\] as const/.exec(src);
  expect(m).not.toBeNull();
  return [...(m?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((x) => x[1] ?? "");
}

function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`## ${heading}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = markdown.slice(start + heading.length + 3);
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
}

/** First-cell backticked kind of each table row of the §Line kinds table. */
function docKindRows(doc: string): string[] {
  return section(doc, "Line kinds")
    .split("\n")
    .filter((l) => l.startsWith("|"))
    .map((l) => /^\|\s*`([a-z_]+)`\s*\|/.exec(l)?.[1])
    .filter((k): k is string => k !== undefined);
}

/** Kinds from `kinds` that have no backticked row in the doc table. */
function missingKinds(kinds: string[], doc: string): string[] {
  const rows = new Set(docKindRows(doc));
  return kinds.filter((k) => !rows.has(k));
}

function exportedFunctions(rel: string): string[] {
  return [...read(rel).matchAll(/^export function (\w+)/gm)].map(
    (m) => m[1] ?? "",
  );
}

describe("G2 contract: line kinds", () => {
  const kinds = lineKindsFromModel(MODEL);

  it("model has the 10 kinds", () => {
    expect(kinds).toHaveLength(10);
  });

  it("every LINE_KINDS literal has a table row in §Line kinds", () => {
    expect(missingKinds(kinds, DOC)).toEqual([]);
  });

  it("every kind row in the table is in LINE_KINDS", () => {
    const extra = docKindRows(DOC).filter((k) => !kinds.includes(k));
    expect(extra).toEqual([]);
    expect(docKindRows(DOC)).toHaveLength(kinds.length);
  });

  it("self-test: an injected missing kind is detected", () => {
    expect(missingKinds([...kinds, "zzz_injected"], DOC)).toEqual([
      "zzz_injected",
    ]);
    const stripped = DOC.replace(/^\| `raw`.*$/m, "");
    expect(missingKinds(kinds, stripped)).toEqual(["raw"]);
  });
});

describe("G2 contract: API names documented", () => {
  const files = [
    "chord.ts",
    "serialize.ts",
    "transpose.ts",
    "song.ts",
    "import.ts",
  ].map((f) => `packages/chord-core/src/${f}`);

  it("finds the expected exported functions", () => {
    const names = files.flatMap(exportedFunctions);
    for (const n of [
      "parseSong",
      "serializeSong",
      "parseChord",
      "formatChord",
      "noteToPitchClass",
      "transposeKey",
      "transposeChord",
      "transposeSong",
      "viewSong",
      "importText",
    ]) {
      expect(names).toContain(n);
    }
  });

  it.each(files)(
    "every exported function of %s is in docs/CHORDPRO.md",
    (f) => {
      const undocumented = exportedFunctions(f).filter(
        (n) => !new RegExp(`\\b${n}\\b`).test(DOC),
      );
      expect(undocumented).toEqual([]);
    },
  );
});

describe("G2 contract: fixtures", () => {
  it("FIXTURE_NAMES is still exactly the 8 G1 names", () => {
    const src = read("packages/test-fixtures/src/index.ts");
    const m = /export const FIXTURE_NAMES = \[([\s\S]*?)\] as const/.exec(src);
    const names = [...(m?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
    expect(names).toEqual([
      "he_plain",
      "he_niqqud",
      "en_plain",
      "mixed_he_en",
      "chord_only_line",
      "sharp_flat_extensions",
      "dense_chords",
      "long_wrap_line",
    ]);
  });

  it("LINE_KINDS_COPY in test-fixtures equals LINE_KINDS as a set", () => {
    const src = read("packages/test-fixtures/src/index.test.ts");
    const m = /const LINE_KINDS_COPY = \[([\s\S]*?)\] as const/.exec(src);
    expect(m).not.toBeNull();
    const copy = [...(m?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map(
      (x) => x[1] ?? "",
    );
    expect(new Set(copy)).toEqual(new Set(lineKindsFromModel(MODEL)));
    expect(copy).toHaveLength(new Set(copy).size);
  });
});
