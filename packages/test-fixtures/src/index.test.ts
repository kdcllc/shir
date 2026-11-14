import { readdirSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FIXTURE_NAMES,
  fixturePath,
  goldenPath,
  isFixtureName,
  readFixture,
  readGolden,
  type FixtureName,
} from "./index";

describe("test-fixtures", () => {
  it("freezes the eight fixture names in order", () => {
    expect([...FIXTURE_NAMES]).toEqual([
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
  it("has unique, well-formed names", () => {
    expect(new Set(FIXTURE_NAMES).size).toBe(FIXTURE_NAMES.length);
    for (const n of FIXTURE_NAMES) expect(n).toMatch(/^[a-z][a-z0-9_]*$/);
  });
  it("isFixtureName discriminates", () => {
    expect(isFixtureName("he_plain")).toBe(true);
    expect(isFixtureName("nope")).toBe(false);
    expect(isFixtureName("")).toBe(false);
  });
  it("resolves absolute fixture paths", () => {
    const p = fixturePath("he_plain");
    expect(isAbsolute(p)).toBe(true);
    expect(p.replaceAll("\\", "/").endsWith("fixtures/he_plain.cho")).toBe(
      true,
    );
  });
  it("throws TypeError for non-fixture names at runtime", () => {
    expect(() => fixturePath("nope" as FixtureName)).toThrow(TypeError);
    expect(() => fixturePath("nope" as FixtureName)).toThrow(/nope/);
  });
});

const LICENCE = "# Original text written for the Shir repository (CC0-1.0)";

interface GLine {
  kind: string;
  lyric?: string;
  chords?: ({ index: number; chord: string } | string)[];
}
interface Golden {
  lines: GLine[];
}

const segmenter = new Intl.Segmenter("he", { granularity: "grapheme" });
const graphemeCount = (s: string): number => [...segmenter.segment(s)].length;

function golden(name: FixtureName): Golden {
  return readGolden(name) as Golden;
}
function lyricLines(name: FixtureName): GLine[] {
  return golden(name).lines.filter((l) => l.kind === "lyric");
}
function anchors(l: GLine): { index: number; chord: string }[] {
  return (l.chords ?? []) as { index: number; chord: string }[];
}

const MARKS = /[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/g;
const HEB = /[\u05D0-\u05EA]/;
function finalFormErrors(text: string): string[] {
  const s = text.replace(MARKS, "");
  const errs: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    const next = s.charAt(i + 1);
    const nextIsLetter = HEB.test(next);
    if ("כמנפצ".includes(c) && !nextIsLetter)
      errs.push(`${c}@${i} non-final at end`);
    if ("ךםןףץ".includes(c) && nextIsLetter)
      errs.push(`${c}@${i} final mid-word`);
  }
  return errs;
}

describe("fixture files", () => {
  it("directory holds exactly the 16 expected files", () => {
    const dir = dirname(fixturePath("he_plain"));
    const expected = FIXTURE_NAMES.flatMap((n) => [
      `${n}.cho`,
      `${n}.golden.json`,
    ]).sort();
    expect(readdirSync(dir).sort()).toEqual(expected);
  });
  it("goldenPath resolves and rejects unknown names", () => {
    const p = goldenPath("he_plain");
    expect(isAbsolute(p)).toBe(true);
    expect(
      p.replaceAll("\\", "/").endsWith("fixtures/he_plain.golden.json"),
    ).toBe(true);
    expect(() => goldenPath("nope" as FixtureName)).toThrow(TypeError);
  });
  it.each([...FIXTURE_NAMES])(
    "%s: files exist, licence line, one trailing newline",
    (n) => {
      const src = readFixture(n);
      expect(src.length).toBeGreaterThan(0);
      expect(src.split("\n")[0]).toBe(LICENCE);
      expect(src.endsWith("\n")).toBe(true);
      expect(src.endsWith("\n\n")).toBe(false);
      expect(readGolden(n)).toBeTypeOf("object");
      expect(Array.isArray(golden(n).lines)).toBe(true);
    },
  );
  it.each([...FIXTURE_NAMES])(
    "%s: anchor indices valid and non-decreasing",
    (n) => {
      for (const l of lyricLines(n)) {
        const max = graphemeCount(l.lyric ?? "");
        let prev = 0;
        for (const a of anchors(l)) {
          expect(Number.isInteger(a.index)).toBe(true);
          expect(a.index).toBeGreaterThanOrEqual(0);
          expect(a.index).toBeLessThanOrEqual(max);
          expect(a.index).toBeGreaterThanOrEqual(prev);
          prev = a.index;
        }
      }
    },
  );
  it.each([...FIXTURE_NAMES])("%s: Hebrew final-form discipline", (n) => {
    for (const l of lyricLines(n)) {
      expect(finalFormErrors(l.lyric ?? "")).toEqual([]);
    }
  });
  it("final-form check fires on bad input", () => {
    expect(finalFormErrors("שלומ").length).toBeGreaterThan(0);
    expect(finalFormErrors("ךא").length).toBeGreaterThan(0);
    expect(finalFormErrors("שלום")).toEqual([]);
  });
  it("mixed_he_en embeds rock and roll", () => {
    expect(
      lyricLines("mixed_he_en").some((l) => l.lyric?.includes("rock and roll")),
    ).toBe(true);
  });
  it("he_niqqud contains dagesh, shin dot and holam", () => {
    const s = readFixture("he_niqqud");
    for (const cp of ["\u05BC", "\u05C1", "\u05B9"]) expect(s).toContain(cp);
  });
  it("sharp_flat_extensions has the four chords verbatim", () => {
    const all = lyricLines("sharp_flat_extensions").flatMap((l) =>
      anchors(l).map((a) => a.chord),
    );
    for (const c of ["C#", "Bb", "F#m7(b5)", "Dsus4/F#"])
      expect(all).toContain(c);
  });
  it("dense_chords has a collision-prone line", () => {
    const dense = lyricLines("dense_chords").find(
      (l) => anchors(l).length >= 8,
    );
    expect(dense).toBeDefined();
    const a = anchors(dense as GLine);
    for (const x of a) expect(x.chord.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < a.length; i++) {
      expect(
        (a[i] as { index: number }).index -
          (a[i - 1] as { index: number }).index,
      ).toBeLessThanOrEqual(2);
    }
  });
  it("long_wrap_line has a long multi-chord line", () => {
    const l = lyricLines("long_wrap_line").find(
      (x) => graphemeCount(x.lyric ?? "") >= 120,
    );
    expect(l).toBeDefined();
    expect(anchors(l as GLine).length).toBeGreaterThanOrEqual(6);
  });
});
