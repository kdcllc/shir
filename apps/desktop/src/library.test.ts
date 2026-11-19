import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSong } from "chord-core";
import { buildLibrary, capoOptions, loadLibrary, songMeta } from "./library";

// Copied from packages/test-fixtures/src/index.ts `ALL_FIXTURE_NAMES`
// (that package is not resolvable from apps/desktop).
const FIXTURE_NAMES = [
  "he_plain",
  "he_niqqud",
  "en_plain",
  "mixed_he_en",
  "chord_only_line",
  "sharp_flat_extensions",
  "dense_chords",
  "long_wrap_line",
  "sections_he",
  "tab_block",
  "unknown_directives",
  "slash_chords_key",
  "aliases_input",
  "malformed_input",
  "rtl_ltr_tail",
];

describe("buildLibrary", () => {
  it("strips path prefixes, builds ids and sorts by fileName", () => {
    const lib = buildLibrary(
      {
        "/x/y/b.cho": "{title: B}\n",
        "../z/a.cho": "{title: A}\n",
        "c.cho": "{title: C}\n",
      },
      "samples",
    );
    expect(lib.map((s) => s.fileName)).toEqual(["a.cho", "b.cho", "c.cho"]);
    expect(lib.map((s) => s.id)).toEqual([
      "samples:a",
      "samples:b",
      "samples:c",
    ]);
    expect(lib.every((s) => s.group === "samples")).toBe(true);
  });

  it("sorts by UTF-16 code units", () => {
    const lib = buildLibrary(
      { "a.cho": "", "B.cho": "", "_.cho": "" },
      "samples",
    );
    expect(lib.map((s) => s.fileName)).toEqual(["B.cho", "_.cho", "a.cho"]);
  });

  it("excludes canonical and non-.cho keys", () => {
    const lib = buildLibrary(
      {
        "d/a.cho": "",
        "d/a.canonical.cho": "",
        "d/a.golden.json": "{}",
        "d/readme.md": "x",
      },
      "test-songs",
    );
    expect(lib.map((s) => s.id)).toEqual(["test-songs:a"]);
  });

  it("falls back to the base name for missing, empty and blank titles", () => {
    const lib = buildLibrary(
      {
        "none.cho": "la\n",
        "empty.cho": "{title:}\n",
        "blank.cho": "{title:   }\n",
        "ok.cho": "{title:  Real  }\n",
      },
      "samples",
    );
    const byName = Object.fromEntries(lib.map((s) => [s.fileName, s.title]));
    expect(byName).toEqual({
      "none.cho": "none",
      "empty.cho": "empty",
      "blank.cho": "blank",
      "ok.cho": "Real",
    });
  });

  it("trims artist and omits the key when absent or empty", () => {
    const lib = buildLibrary(
      {
        "a.cho": "{artist:   Foo  }\n",
        "b.cho": "{title: B}\n",
        "c.cho": "{artist:}\n",
        "d.cho": "{artist:  }\n{artist: Second}\n",
      },
      "samples",
    );
    const [a, b, c, d] = lib;
    expect(a?.artist).toBe("Foo");
    expect("artist" in (b as object)).toBe(false);
    expect("artist" in (c as object)).toBe(false);
    expect(d?.artist).toBe("Second");
  });

  it("carries parse diagnostics through", () => {
    const [entry] = buildLibrary(
      { "x.cho": "{start_of_chorus}\nla\n" },
      "samples",
    );
    expect(entry?.diagnostics.length).toBeGreaterThan(0);
    expect(entry?.diagnostics).toEqual(
      parseSong("{start_of_chorus}\nla\n").diagnostics,
    );
  });

  it("does not mutate the input record", () => {
    const input = { "b.cho": "{title: B}\n", "a.cho": "{title: A}\n" };
    const snapshot = JSON.stringify(input);
    const keys = Object.keys(input);
    buildLibrary(input, "samples");
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(Object.keys(input)).toEqual(keys);
  });
});

describe("songMeta", () => {
  const song = parseSong(
    "{artist:}\n{artist:  First  }\n{artist: Second}\n{album: Alb}\n",
  ).song;

  it("returns the first non-empty trimmed match, skipping empty values", () => {
    expect(songMeta(song, "artist")).toBe("First");
    expect(songMeta(song, "album")).toBe("Alb");
  });

  it("returns undefined for a missing name", () => {
    expect(songMeta(song, "composer")).toBeUndefined();
  });
});

describe("capoOptions", () => {
  const base = Array.from({ length: 13 }, (_, i) => i);

  it.each([undefined, 0, 5, 12])("gives 0..12 for %s", (v) => {
    expect(capoOptions(v)).toEqual(base);
  });

  it.each([13, 24])("appends %s", (v) => {
    expect(capoOptions(v)).toEqual([...base, v]);
  });

  it.each([25, -1, 2.5])("gives 0..12 only for %s", (v) => {
    expect(capoOptions(v)).toEqual(base);
  });
});

function choCount(dirUrl: string): number {
  return readdirSync(fileURLToPath(new URL(dirUrl, import.meta.url))).filter(
    (n) => n.endsWith(".cho") && !n.endsWith(".canonical.cho"),
  ).length;
}

describe("loadLibrary", () => {
  const lib = loadLibrary();
  const samples = lib.filter((s) => s.group === "samples");
  const tests = lib.filter((s) => s.group === "test-songs");

  it("orders samples before test-songs with no entries lost", () => {
    const lastSample = lib.map((s) => s.group).lastIndexOf("samples");
    const firstTest = lib.map((s) => s.group).indexOf("test-songs");
    expect(samples.length).toBeGreaterThan(0);
    expect(lastSample).toBeLessThan(firstTest);
    const samplesOnDisk = choCount("../../../samples");
    const fixturesOnDisk = choCount("../../../packages/test-fixtures/fixtures");
    expect(samplesOnDisk).toBeGreaterThan(0);
    expect(fixturesOnDisk).toBeGreaterThan(0);
    expect(samples.length).toBe(samplesOnDisk);
    expect(tests.length).toBe(fixturesOnDisk);
    expect(lib.length).toBe(samplesOnDisk + fixturesOnDisk);
    expect(lib.map((s) => s.id)).toContain("samples:demo-shir-bilingual");
  });

  it("includes all 15 fixtures and no canonical ids", () => {
    const ids = tests.map((s) => s.id);
    for (const name of FIXTURE_NAMES) {
      expect(ids).toContain(`test-songs:${name}`);
    }
    expect(lib.some((s) => s.id.includes("canonical"))).toBe(false);
  });

  it("exposes the demo sample title and artist", () => {
    const demo = lib.find((s) => s.id === "samples:demo-shir-bilingual");
    expect(demo?.title).toBe("שיר הדגמה / Demo Song");
    expect(demo?.artist).toBe("Shir demo");
  });

  it("carries diagnostics for malformed_input", () => {
    const m = lib.find((s) => s.id === "test-songs:malformed_input");
    expect(m?.diagnostics.length).toBeGreaterThan(0);
  });

  it("is memoized", () => {
    expect(loadLibrary()).toBe(loadLibrary());
  });
});
