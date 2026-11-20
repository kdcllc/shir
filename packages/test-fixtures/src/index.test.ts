import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALL_FIXTURE_NAMES,
  EDIT_CASES_PATH,
  EXPORT_GOLDEN_CASES,
  FIXTURE_NAMES,
  ROUNDTRIP_FIXTURE_NAMES,
  canonicalPath,
  fixturePath,
  goldenPath,
  hasLogicalGolden,
  IMPORT_FIXTURE_NAMES,
  isFixtureName,
  readImportGolden,
  readImportInput,
  readCanonical,
  readDiagnostics,
  readEditCases,
  readExportGolden,
  readFixture,
  readGolden,
  type FixtureName,
  type ImportFixtureName,
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
  it("directory holds exactly the expected files", () => {
    const dir = dirname(fixturePath("he_plain"));
    const expected = [
      ...ALL_FIXTURE_NAMES.flatMap((n) => [`${n}.cho`, `${n}.golden.json`]),
      "aliases_input.canonical.cho",
      "malformed_input.diagnostics.json",
    ].sort();
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
  it.each([...ALL_FIXTURE_NAMES])(
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
  it.each([...ALL_FIXTURE_NAMES])(
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
  it.each([...ALL_FIXTURE_NAMES])("%s: Hebrew final-form discipline", (n) => {
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

// Copy of chord-core's LINE_KINDS (packages/chord-core/src/model.ts). test-fixtures
// must not import chord-core (chord-core devDepends on this package); the chord-core
// tests (task 06 R3) guard this copy against drift.
const LINE_KINDS_COPY = [
  "lyric",
  "chords",
  "empty",
  "meta",
  "comment",
  "section",
  "tab",
  "remark",
  "directive",
  "raw",
] as const;

describe("round-trip fixtures", () => {
  it("freezes the seven round-trip names in order", () => {
    expect([...ROUNDTRIP_FIXTURE_NAMES]).toEqual([
      "sections_he",
      "tab_block",
      "unknown_directives",
      "slash_chords_key",
      "aliases_input",
      "malformed_input",
      "rtl_ltr_tail",
    ]);
    expect([...ALL_FIXTURE_NAMES]).toEqual([
      ...FIXTURE_NAMES,
      ...ROUNDTRIP_FIXTURE_NAMES,
    ]);
    expect(isFixtureName("tab_block")).toBe(true);
  });
  it("canonicalPath uses .canonical.cho when present, else the fixture", () => {
    expect(
      canonicalPath("aliases_input")
        .replaceAll("\\", "/")
        .endsWith("fixtures/aliases_input.canonical.cho"),
    ).toBe(true);
    expect(canonicalPath("he_plain")).toBe(fixturePath("he_plain"));
    expect(readCanonical("he_plain")).toBe(readFixture("he_plain"));
    expect(readCanonical("aliases_input")).not.toBe(
      readFixture("aliases_input"),
    );
    expect(() => canonicalPath("nope" as FixtureName)).toThrow(TypeError);
    expect(() => readCanonical("nope" as FixtureName)).toThrow(TypeError);
  });
  it("readDiagnostics returns the file or []", () => {
    expect(readDiagnostics("he_plain")).toEqual([]);
    const d = readDiagnostics("malformed_input") as { code: string }[];
    expect(d.map((x) => x.code)).toEqual([
      "section-unopened",
      "syntax",
      "syntax",
      "syntax",
      "section-unclosed",
    ]);
    expect(() => readDiagnostics("nope" as FixtureName)).toThrow(TypeError);
  });
  it("aliases_input.cho is stored with LF endings only", () => {
    expect(readFixture("aliases_input")).not.toContain("\r");
  });
  it("goldens cover all ten line kinds", () => {
    const seen = new Set(
      ROUNDTRIP_FIXTURE_NAMES.flatMap((n) =>
        golden(n).lines.map((l) => l.kind),
      ),
    );
    for (const k of LINE_KINDS_COPY) expect(seen.has(k)).toBe(true);
    expect(LINE_KINDS_COPY).toHaveLength(10);
  });
  it("rtl_ltr_tail is a round-trip fixture, not a G1 fixture", () => {
    expect(isFixtureName("rtl_ltr_tail")).toBe(true);
    expect(
      (ROUNDTRIP_FIXTURE_NAMES as readonly string[]).includes("rtl_ltr_tail"),
    ).toBe(true);
    expect((FIXTURE_NAMES as readonly string[]).includes("rtl_ltr_tail")).toBe(
      false,
    );
  });
  it("rtl_ltr_tail has a Hebrew line ending in a Latin word plus an end chord", () => {
    const src = readFixture("rtl_ltr_tail");
    expect(src).toMatch(/[\u0590-\u05FF][^\n]*[A-Za-z]\[[^\]]+\]\s*$/m);
    const tails = lyricLines("rtl_ltr_tail").filter((l) => {
      const a = anchors(l);
      const last = a[a.length - 1];
      return (
        HEB.test(l.lyric ?? "") &&
        /[A-Za-z]$/.test(l.lyric ?? "") &&
        last !== undefined &&
        last.index === graphemeCount(l.lyric ?? "")
      );
    });
    expect(tails.length).toBeGreaterThanOrEqual(2);
    expect(src).not.toMatch(/\{(meta:\s*)?direction/);
  });
  it("the removed phrase appears in no fixture once chords are stripped", () => {
    const phrase = "\u05DC\u05D9\u05DC\u05D4 \u05E9\u05E7\u05D8";
    for (const n of ALL_FIXTURE_NAMES) {
      expect(readFixture(n).replace(/\[[^\]]*\]/g, "")).not.toContain(phrase);
    }
  });
  it("raw goldens come from malformed_input", () => {
    const rawOwners = ROUNDTRIP_FIXTURE_NAMES.filter((n) =>
      golden(n).lines.some((l) => l.kind === "raw"),
    );
    expect(rawOwners).toEqual(["malformed_input"]);
  });
});

// import fixtures: every golden is hand-derived from Import rules R1-R10
// (02-chord-core-importer.md). Chord column spans [s, e) count code points of
// the chord line; lyric indices count graphemes (niqqud never takes a column).
// mirror (RTL): i = n - e, clamped to 0 when e > n. logical / LTR: i = s,
// clamped to n when s > n. Then forward snap off whitespace.
//
// derivation he_over_lyrics (n = graphemes of the lyric)
//   "שלום לכם בבית" n=13: C s=1 e=2, G s=7 e=8, Am s=11 e=13
//     mirror : C i=13-2=11 (mid-word), G i=13-8=5, Am i=13-13=0
//     logical: C i=1, G i=7, Am i=11
//   "לילה" n=4: Dm7 s=5 e=8 (past the lyric)
//     mirror : i=4-8<0 -> clamp 0 + chord-past-end;  logical: i=5>4 -> n=4 + chord-past-end
//   "הים שקט" n=7: F s=2 e=3, Em s=5 e=7
//     mirror : F i=7-3=4, Em i=7-7=0;  logical: F i=2, Em i=5
// derivation he_niqqud_over_lyrics (marks stay in their grapheme)
//   "שָׁלוֹם לכָם בַּבַּיִת" n=13: Em s=2 e=4, G s=7 e=8, Am s=11 e=13
//     mirror : Em i=13-4=9 (בַּ with dagesh), G i=5, Am i=0 (שָׁ with shin dot)
//     logical: Em i=2 (וֹ with holam), G i=7, Am i=11
//   "שִׁיר קָטָן" n=7: D s=2 e=3, Bm s=5 e=7
//     mirror : D i=4, Bm i=0;  logical: D i=2, Bm i=5
// derivation en_over_lyrics (LTR: i = s in both modes)
//   "Walking down the lane" n=21: Am s=0 -> 0; G s=7 is the space -> snap forward to 8
//   "Open the door" n=13: C s=0, G/B s=5, Fmaj7 s=16 > n -> 13 + chord-past-end
//   chord-only line "Am  G  C  F" -> "[Am] [G] [C] [F]" (followed by a blank line)
//   "Quiet rivers carry me home" n=26: C 0, Em 6, F 13
// derivation mixed_over_lyrics (mirror = bidi-run visual map, R6 as amended by Q&A row 13)
//   "אני שר blues בלילה" n=18 (first strong = Hebrew -> rtl). Indices: אני 0-2, sp 3, שר 4-5,
//     sp 6, blues 7-11, sp 12, בלילה 13-17.
//   types : R x3, N(3), R x2, N(6), L x5, N(12), R x5; N3 sits between R and R -> R;
//           N6 (R before, L after) and N12 (L before, R after) -> L (paragraph direction)
//   levels: 0-5 -> 1, 6-12 -> 0, 13-17 -> 1 (no EN, so no level 2)
//   L2    : reverse [0..5] and [13..17]
//   vis   : [5,4,3,2,1,0, 6,7,8,9,10,11,12, 17,16,15,14,13]
//   chord line "G Em Dm7 Dm   F Am": G s=0 e=1, Em s=2 e=4, Dm7 s=5 e=8, Dm s=9 e=11, F s=14 e=15, Am s=16 e=18
//     mirror : G   vis[0]=5 odd -> rule 2 vis[0]=5   -> i=5  (ש[G]ר)
//              Em  vis[2]=3 odd -> rule 2 vis[3]=2   -> i=2  (אנ[Em]י)
//              Dm7 vis[5]=0 odd -> rule 2 vis[7]=7   -> i=7  ([Dm7]blues; straddles the RTL->LTR boundary)
//              Dm  vis[9]=9 even -> rule 1           -> i=9  (bl[Dm]ues)
//              F   vis[14]=16 odd -> rule 2 vis[14]  -> i=16 (בלי[F]לה)
//              Am  vis[16]=14 odd -> rule 2 vis[17]=13 -> i=13 ([Am]בלילה)
//     logical: i = s: G 0, Em 2, Dm7 5 (mid שר), Dm 9, F 14, Am 16
//   English line n=26 (ltr): C s=0, G s=6, Am s=13, F s=22 in both modes
// derivation header_he_over_lyrics (directives and the inline-chord line pass through)
//   "שיר קטן לערב" n=12: C s=3 e=4, G s=7 e=8, Am s=10 e=12
//     mirror : C 8, G 4, Am 0;  logical: C s=3 is a space -> snap 4, G s=7 space -> 8, Am 10
//   "חלום ורוד" n=9: E s=3 e=4, Dm s=7 e=9
//     mirror : E 5, Dm 0;  logical: E 3, Dm 7
// chordpro_passthrough: golden == input (no chord line outside {start_of_tab}).

const IMPORT_LICENCE = LICENCE;
const IMPORT_DIR = fileURLToPath(new URL("../import/", import.meta.url));
const RTL_IMPORT = IMPORT_FIXTURE_NAMES.filter((n) => hasLogicalGolden(n));

function importFileNames(): string[] {
  return [
    ...IMPORT_FIXTURE_NAMES.flatMap((n) => [`${n}.txt`, `${n}.cho`]),
    ...RTL_IMPORT.map((n) => `${n}.logical.cho`),
  ].sort();
}

function importVariants(n: ImportFixtureName): string[] {
  return [
    readImportInput(n),
    readImportGolden(n),
    ...(hasLogicalGolden(n) ? [readImportGolden(n, "logical")] : []),
  ];
}

describe("import fixtures", () => {
  it("freezes the six import names in order", () => {
    expect([...IMPORT_FIXTURE_NAMES]).toEqual([
      "he_over_lyrics",
      "he_niqqud_over_lyrics",
      "en_over_lyrics",
      "mixed_over_lyrics",
      "chordpro_passthrough",
      "header_he_over_lyrics",
    ]);
    expect(RTL_IMPORT).toEqual([
      "he_over_lyrics",
      "he_niqqud_over_lyrics",
      "mixed_over_lyrics",
      "header_he_over_lyrics",
    ]);
  });
  it("directory holds exactly the expected files", () => {
    expect(readdirSync(IMPORT_DIR).sort()).toEqual(importFileNames());
  });
  it.each([...IMPORT_FIXTURE_NAMES])(
    "%s: licence line, one trailing newline",
    (n) => {
      for (const src of importVariants(n)) {
        expect(src.split("\n")[0]).toBe(IMPORT_LICENCE);
        expect(src.endsWith("\n")).toBe(true);
        expect(src.endsWith("\n\n")).toBe(false);
        expect(src).not.toContain("\r");
      }
    },
  );
  it.each([...IMPORT_FIXTURE_NAMES])(
    "%s: Hebrew final-form discipline",
    (n) => {
      for (const src of importVariants(n)) {
        for (const line of src.split("\n")) {
          // drop inline chord tokens so a chord between letters cannot hide a form
          expect(finalFormErrors(line.replace(/\[[^\]]*\]/g, ""))).toEqual([]);
        }
      }
    },
  );
  it.each(RTL_IMPORT)("%s: mirror and logical goldens differ", (n) => {
    expect(readImportGolden(n, "logical")).not.toBe(readImportGolden(n));
  });
  it("non-RTL fixtures have no logical golden", () => {
    expect(hasLogicalGolden("en_over_lyrics")).toBe(false);
    expect(hasLogicalGolden("chordpro_passthrough")).toBe(false);
    expect(() => readImportGolden("en_over_lyrics", "logical")).toThrow(
      TypeError,
    );
  });
  it("chordpro_passthrough golden equals its input", () => {
    expect(readImportGolden("chordpro_passthrough")).toBe(
      readImportInput("chordpro_passthrough"),
    );
  });
  it("niqqud fixture has dagesh, shin dot and holam", () => {
    const s = readImportInput("he_niqqud_over_lyrics");
    for (const cp of ["\u05BC", "\u05C1", "\u05B9"]) expect(s).toContain(cp);
  });
  it("helpers throw TypeError on unknown names", () => {
    const bad = "nope" as ImportFixtureName;
    expect(() => readImportInput(bad)).toThrow(TypeError);
    expect(() => readImportGolden(bad)).toThrow(TypeError);
    expect(() => readImportGolden(bad, "logical")).toThrow(TypeError);
    expect(() => hasLogicalGolden(bad)).toThrow(TypeError);
    expect(() => readImportInput("__proto__" as ImportFixtureName)).toThrow(
      TypeError,
    );
  });
});

describe("edit cases", () => {
  const EDIT_DIR = fileURLToPath(new URL("../edit/", import.meta.url));

  it("EDIT_CASES_PATH is the absolute path of edit/cases.json", () => {
    expect(isAbsolute(EDIT_CASES_PATH)).toBe(true);
    expect(
      EDIT_CASES_PATH.replaceAll("\\", "/").endsWith(
        "test-fixtures/edit/cases.json",
      ),
    ).toBe(true);
    expect(readdirSync(EDIT_DIR)).toEqual(["cases.json"]);
  });
  it("the file parses to at least 12 well-formed cases", () => {
    const cases = readEditCases();
    expect(Array.isArray(cases)).toBe(true);
    expect(cases.length).toBeGreaterThanOrEqual(12);
    for (const c of cases) {
      expect(Object.keys(c).sort()).toEqual([
        "expected",
        "fixture",
        "name",
        "ops",
      ]);
      expect(c.name).toBeTypeOf("string");
      expect(c.name.trim()).not.toBe("");
      expect(Array.isArray(c.ops)).toBe(true);
      expect(c.ops.length).toBeGreaterThan(0);
      for (const op of c.ops) {
        expect((op as { type?: unknown }).type).toBeTypeOf("string");
      }
      expect(c.expected).toBeTypeOf("string");
      expect(c.expected).not.toContain("\r");
    }
  });
  it("every case names a known fixture and differs from its source", () => {
    for (const c of readEditCases()) {
      expect(isFixtureName(c.fixture)).toBe(true);
      expect(c.expected).not.toBe(readFixture(c.fixture));
    }
  });
  it("case names are unique", () => {
    const names = readEditCases().map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
  it("covers the Hebrew, niqqud, mixed and structural fixtures", () => {
    const count = (name: FixtureName): number =>
      readEditCases().filter((c) => c.fixture === name).length;
    expect(count("he_plain")).toBeGreaterThanOrEqual(3);
    expect(count("he_niqqud")).toBeGreaterThanOrEqual(2);
    expect(count("mixed_he_en")).toBeGreaterThanOrEqual(2);
    expect(count("sections_he")).toBeGreaterThanOrEqual(2);
    expect(count("en_plain")).toBeGreaterThanOrEqual(1);
    expect(count("tab_block")).toBeGreaterThanOrEqual(1);
    expect(count("chord_only_line")).toBeGreaterThanOrEqual(1);
  });
  it("edit cases add no Hebrew final-form errors", () => {
    for (const c of readEditCases()) {
      for (const line of c.expected.split("\n")) {
        expect(finalFormErrors(line.replace(/\[[^\]]*\]/g, ""))).toEqual([]);
      }
    }
  });
});

describe("export goldens", () => {
  const EXPORT_DIR = fileURLToPath(new URL("../export/", import.meta.url));

  it("lists the seven cases with matching file names", () => {
    expect(EXPORT_GOLDEN_CASES.map((c) => c.fixture)).toEqual([
      "he_plain",
      "he_niqqud",
      "mixed_he_en",
      "chord_only_line",
      "sections_he",
      "dense_chords",
      "rtl_ltr_tail",
    ]);
    for (const c of EXPORT_GOLDEN_CASES) {
      expect(isFixtureName(c.fixture)).toBe(true);
      expect(c.file).toBe(
        `${c.fixture}.t${String(c.transpose)}c${String(c.capo)}.export.json`,
      );
    }
  });
  it("every listed file exists and parses as an ExportSong without model", () => {
    for (const c of EXPORT_GOLDEN_CASES) {
      expect(readdirSync(EXPORT_DIR)).toContain(c.file);
      const g = readExportGolden(c) as Record<string, unknown>;
      expect(g).toBeTypeOf("object");
      expect(Array.isArray(g.lines)).toBe(true);
      expect("model" in g).toBe(false);
      expect(readExportGolden(c.file)).toEqual(g);
    }
  });
  it("every file in export/ is listed (no orphans)", () => {
    expect(readdirSync(EXPORT_DIR).sort()).toEqual(
      EXPORT_GOLDEN_CASES.map((c) => c.file).sort(),
    );
  });
  it("rejects unknown golden files", () => {
    expect(() => readExportGolden("nope.export.json")).toThrow(TypeError);
  });
});
