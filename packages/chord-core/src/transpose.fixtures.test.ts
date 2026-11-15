import { describe, expect, it } from "vitest";
import { FIXTURE_NAMES, readFixture } from "test-fixtures";
import {
  parseSong,
  serializeSong,
  transposeKey,
  transposeSong,
  viewSong,
} from "./index";
import type { SongLine, SongModel } from "./index";

const KEYED = ["sections_he", "slash_chords_key", "aliases_input"] as const;
const STEPS = Array.from({ length: 11 }, (_, i) => i + 1);

/**
 * Documented out-of-key exceptions (docs/CHORDPRO.md `## Chords and
 * transpose`: "Out-of-key chords may be respelled"). Maps fixture to the
 * original chord text that may come back respelled.
 */
const OUT_OF_KEY_EXCEPTIONS: Record<string, Record<string, string>> = {
  slash_chords_key: {
    // F#m7b5 is not diatonic to Bb; the flat-style key respells it Gbm7b5.
    "F#m7b5": "Gbm7b5",
  },
};

function parse(name: (typeof KEYED)[number]): SongModel {
  return parseSong(readFixture(name)).song;
}

/** Replace documented exceptions' chord text by their respelling in `m`. */
function withExceptionsRespelled(name: string, m: SongModel): SongModel {
  const map = OUT_OF_KEY_EXCEPTIONS[name] ?? {};
  const c = structuredClone(m);
  for (const l of c.lines) {
    if (l.kind === "lyric") {
      for (const a of l.chords) a.chord = map[a.chord] ?? a.chord;
    } else if (l.kind === "chords") {
      l.chords = l.chords.map((x) => map[x] ?? x);
    }
  }
  return c;
}

function chordsOf(lines: SongLine[]): string[] {
  return lines.flatMap((l) =>
    l.kind === "lyric"
      ? l.chords.map((a) => a.chord)
      : l.kind === "chords"
        ? l.chords
        : [],
  );
}

describe("transpose over keyed fixtures", () => {
  for (const name of KEYED) {
    describe(name, () => {
      it.each(STEPS)("+%i then -%i round-trips in-key chords", (n) => {
        const m = parse(name);
        const there = transposeSong(m, n).song;
        const back = transposeSong(there, -n).song;
        expect(back).toEqual(withExceptionsRespelled(name, m));
      });

      it.each(STEPS)("%i: serialize re-parses to an equal model", (n) => {
        const t = transposeSong(parse(name), n).song;
        const reparsed = parseSong(serializeSong(t)).song;
        expect(reparsed).toEqual(t);
        const expectedKey = transposeKey(parse(name).key as string, n);
        expect(reparsed.key).toBe(expectedKey);
        const keyLines = reparsed.lines.filter(
          (l) => l.kind === "meta" && l.name === "key",
        );
        expect(keyLines.length).toBeGreaterThan(0);
        for (const l of keyLines) {
          expect(l.kind === "meta" && l.value).toBe(expectedKey);
        }
      });
    });
  }

  it("lists exactly the documented out-of-key exception for slash_chords_key", () => {
    const m = parse("slash_chords_key");
    const back = transposeSong(transposeSong(m, 5).song, -5).song;
    const orig = chordsOf(m.lines);
    const got = chordsOf(back.lines);
    const differing = orig
      .map((c, i) => [c, got[i]] as const)
      .filter(([a, b]) => a !== b);
    expect(differing).toEqual([["F#m7b5", "Gbm7b5"]]);
  });

  it("other keyed fixtures need no exceptions", () => {
    for (const name of ["sections_he", "aliases_input"] as const) {
      const m = parse(name);
      for (const n of STEPS) {
        const back = transposeSong(transposeSong(m, n).song, -n).song;
        expect(back).toEqual(m);
      }
    }
  });

  it("N.C. yields exactly one unknown-chord diagnostic per transpose and is kept verbatim", () => {
    const m = parse("slash_chords_key");
    for (const n of [-5, ...STEPS]) {
      const r = transposeSong(m, n);
      const unknown = r.diagnostics.filter((d) => d.code === "unknown-chord");
      expect(unknown).toHaveLength(1);
      expect(unknown[0]?.message).toBe('Unrecognized chord "N.C."');
      expect(r.diagnostics).toHaveLength(1);
      expect(chordsOf(r.song.lines)).toContain("N.C.");
    }
  });
});

describe("sections_he capo view", () => {
  const m = parse("sections_he");

  it("has capo 2 and key Am", () => {
    expect(m.capo).toBe(2);
    expect(m.key).toBe("Am");
  });

  it("view shapes equal transposeSong(m, -2) chords", () => {
    const v = viewSong(m);
    const t = transposeSong(m, -2).song;
    expect(v.capo).toBe(2);
    expect(chordsOf(v.song.lines)).toEqual(chordsOf(t.lines));
    expect(chordsOf(v.song.lines)).not.toEqual(chordsOf(m.lines));
  });

  it("leaves meta lines and song.key untouched", () => {
    const v = viewSong(m);
    const metas = (s: SongModel) => s.lines.filter((l) => l.kind === "meta");
    expect(metas(v.song)).toEqual(metas(m));
    expect(v.song.key).toBe("Am");
  });

  it("soundingKey and shapeKey match the capo formulas", () => {
    const v = viewSong(m);
    expect(v.soundingKey).toBe(transposeKey("Am", 0));
    expect(v.shapeKey).toBe(transposeKey("Am", -2));
    expect(v.shapeKey).toBe("Gm");
    const v3 = viewSong(m, { transpose: 3 });
    expect(v3.soundingKey).toBe(transposeKey("Am", 3));
    expect(v3.shapeKey).toBe(transposeKey("Am", 1));
  });
});

describe("G1 fixtures without a key", () => {
  it.each([...FIXTURE_NAMES])(
    "%s: transpose by 12 and 0 is the identity",
    (name) => {
      const m = parseSong(readFixture(name)).song;
      expect(m.key).toBeUndefined();
      expect(transposeSong(m, 12).song).toEqual(m);
      expect(transposeSong(m, 0).song).toEqual(m);
    },
  );
});
