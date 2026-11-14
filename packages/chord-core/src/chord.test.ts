import { describe, expect, it } from "vitest";
import {
  formatChord,
  noteToPitchClass,
  parseChord,
  transposeChord,
  transposeKey,
} from "./chord";

const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const DEFAULT = [
  "C",
  "C#",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
];

describe("parseChord", () => {
  it.each([
    ["F#m7(b5)", { root: "F#", suffix: "m7(b5)" }],
    ["C6/9", { root: "C", suffix: "6/9" }],
    ["C/9", { root: "C", suffix: "/9" }],
    ["Dsus4/F#", { root: "D", suffix: "sus4", bass: "F#" }],
    ["Am7/G", { root: "A", suffix: "m7", bass: "G" }],
    ["C/E", { root: "C", suffix: "", bass: "E" }],
    ["Bbsus4", { root: "Bb", suffix: "sus4" }],
    ["Ebmaj7", { root: "Eb", suffix: "maj7" }],
    ["B", { root: "B", suffix: "" }],
  ])("parses %s", (text, expected) => {
    expect(parseChord(text)).toStrictEqual(expected);
  });

  it("has no bass key without a slash bass", () => {
    expect(parseChord("C6/9")).not.toHaveProperty("bass");
  });

  it.each(["", "c", "H7", "N.C.", "x", "C ", " C", "C maj", "C\tm"])(
    "returns null for %j",
    (text) => {
      expect(parseChord(text)).toBeNull();
    },
  );

  it.each([
    "F#m7(b5)",
    "C6/9",
    "C/9",
    "Dsus4/F#",
    "Am7/G",
    "C/E",
    "Bbsus4",
    "Ebmaj7",
    "G/Bb",
    "C",
  ])("round-trips format(parse(%s))", (t) => {
    const p = parseChord(t);
    expect(p).not.toBeNull();
    expect(formatChord(p!)).toBe(t);
  });
});

describe("noteToPitchClass", () => {
  it.each([
    ["C", 0],
    ["C#", 1],
    ["Db", 1],
    ["D", 2],
    ["D#", 3],
    ["Eb", 3],
    ["E", 4],
    ["Fb", 4],
    ["E#", 5],
    ["F", 5],
    ["F#", 6],
    ["Gb", 6],
    ["G", 7],
    ["G#", 8],
    ["Ab", 8],
    ["A", 9],
    ["A#", 10],
    ["Bb", 10],
    ["B", 11],
    ["Cb", 11],
    ["B#", 0],
  ])("%s -> %i", (note, pc) => {
    expect(noteToPitchClass(note)).toBe(pc);
  });

  it.each(["", "H", "c", "C##", "Cm", "N.C."])("returns null for %j", (n) => {
    expect(noteToPitchClass(n)).toBeNull();
  });
});

describe("transposeKey", () => {
  it.each([
    ["C", 1, "Db"],
    ["C", 6, "F#"],
    ["C", 7, "G"],
    ["G", 3, "Bb"],
    ["Am", 3, "Cm"],
    ["Am", 2, "Bm"],
    ["Am", 6, "D#m"],
    ["Em", 8, "Cm"],
    ["F#", 6, "C"],
    ["Bb", 4, "D"],
    ["C", -1, "B"],
    ["C", 13, "Db"],
    ["Cm", 1, "C#m"],
    ["Gm", 7, "Dm"],
  ])("%s by %i -> %s", (key, n, out) => {
    expect(transposeKey(key, n)).toBe(out);
  });

  it("uses prefer on ties and defaults to sharp", () => {
    expect(transposeKey("C", 6)).toBe("F#");
    expect(transposeKey("C", 6, "sharp")).toBe("F#");
    expect(transposeKey("C", 6, "flat")).toBe("Gb");
    expect(transposeKey("Am", 6)).toBe("D#m");
    expect(transposeKey("Am", 6, "flat")).toBe("Ebm");
  });

  it("returns key unchanged for n = 0 mod 12", () => {
    expect(transposeKey("Cb", 0)).toBe("Cb");
    expect(transposeKey("Gb", 12)).toBe("Gb");
    expect(transposeKey("Am", -24)).toBe("Am");
  });

  it.each(["", "H", "Cmaj7", "C7", "am", "Amm", "C m", "N.C."])(
    "null for %j",
    (k) => {
      expect(transposeKey(k, 2)).toBeNull();
    },
  );

  it("throws RangeError for a non-integer shift", () => {
    expect(() => transposeKey("C", 1.5)).toThrow(RangeError);
  });
});

describe("transposeChord", () => {
  const roots12 = SHARP;
  describe("all 12 roots by style", () => {
    // Shift C-rooted chords by n with key C (neutral), a sharp key, a flat key and no key.
    it.each(Array.from({ length: 12 }, (_, i) => i))("no key, n = %i", (n) => {
      expect(transposeChord("C", n).chord).toBe(DEFAULT[n]);
      expect(transposeChord("C", n, { prefer: "sharp" }).chord).toBe(SHARP[n]);
      expect(transposeChord("C", n, { prefer: "flat" }).chord).toBe(FLAT[n]);
    });

    it.each(roots12.map((_, i) => i))(
      "sharp-style key (G + n -> D) pc %i",
      (pc) => {
        // Source key A, shift so the target key is sharp-style (E): +7 from A is E.
        const root = SHARP[pc] as string;
        const out = transposeChord(root, 7, { key: "A" }).chord;
        expect(out).toBe(SHARP[(pc + 7) % 12]);
      },
    );

    it.each(roots12.map((_, i) => i))(
      "flat-style key (target F) pc %i",
      (pc) => {
        const root = FLAT[pc] as string;
        // Source C, +5 -> F (flat-style).
        expect(transposeChord(root, 5, { key: "C" }).chord).toBe(
          FLAT[(pc + 5) % 12],
        );
      },
    );

    it.each(roots12.map((_, i) => i))(
      "no key + minor C key neutral pc %i",
      (pc) => {
        expect(
          transposeChord(SHARP[pc] as string, 12 + 0, { key: "Cm" }).chord,
        ).toBe(SHARP[pc]);
        expect(
          transposeChord(SHARP[pc] as string, 12 + 5, { key: "Em" }).chord,
        ).toBe(DEFAULT[(pc + 5) % 12]);
      },
    );
  });

  it("neutral target key uses prefer when given", () => {
    expect(transposeChord("D", 1, { key: "B", prefer: "flat" }).chord).toBe(
      "Eb",
    );
    // B + 1 -> C (neutral): prefer decides.
    expect(transposeChord("F", 1, { key: "B", prefer: "flat" }).chord).toBe(
      "Gb",
    );
    expect(transposeChord("F", 1, { key: "B", prefer: "sharp" }).chord).toBe(
      "F#",
    );
    expect(transposeChord("F", 1, { key: "B" }).chord).toBe("F#");
  });

  it("ignores an unparseable key", () => {
    expect(transposeChord("C", 1, { key: "nonsense" }).chord).toBe("C#");
    expect(transposeChord("C", 3, { key: "nonsense" }).chord).toBe("Eb");
  });

  it("spells the bass like the root", () => {
    expect(transposeChord("C/E", 1, { key: "C" })).toStrictEqual({
      chord: "Db/F",
      ok: true,
    });
    expect(transposeChord("C/E", 5, { key: "C" })).toStrictEqual({
      chord: "F/A",
      ok: true,
    });
    expect(transposeChord("C/Bb", 3, { key: "C" })).toStrictEqual({
      chord: "Eb/Db",
      ok: true,
    });
    expect(transposeChord("Dsus4/F#", 2, { key: "D" })).toStrictEqual({
      chord: "Esus4/G#",
      ok: true,
    });
    expect(transposeChord("Am7/G", 1, { prefer: "flat" })).toStrictEqual({
      chord: "Bbm7/Ab",
      ok: true,
    });
  });

  it("keeps the suffix verbatim", () => {
    expect(transposeChord("F#m7(b5)", 2, { key: "E" }).chord).toBe("G#m7(b5)");
    expect(transposeChord("C6/9", 2).chord).toBe("D6/9");
    expect(transposeChord("C/9", 2).chord).toBe("D/9");
  });

  it("returns the input verbatim for n = 0 mod 12, even Cb", () => {
    expect(transposeChord("Cb", 0)).toStrictEqual({ chord: "Cb", ok: true });
    expect(transposeChord("E#m/B#", 12, { key: "F#" })).toStrictEqual({
      chord: "E#m/B#",
      ok: true,
    });
    expect(transposeChord("Db", -24, { prefer: "sharp" })).toStrictEqual({
      chord: "Db",
      ok: true,
    });
  });

  it("passes unparseable chords through with ok false", () => {
    for (const c of ["N.C.", "x", "", "C maj", "H7", "c"]) {
      expect(transposeChord(c, 2)).toStrictEqual({ chord: c, ok: false });
      expect(transposeChord(c, 0)).toStrictEqual({ chord: c, ok: false });
    }
  });

  it("throws RangeError for non-integer shifts", () => {
    for (const n of [
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(() => transposeChord("C", n)).toThrow(RangeError);
    }
  });

  it("never outputs E#/B#/Cb/Fb when shifting", () => {
    const inputs = ["E#", "B#", "Cb", "Fb", "E#m/B#", "Fb/Cb"];
    for (const c of inputs) {
      for (let n = 1; n <= 11; n++) {
        for (const key of [undefined, "C", "F#", "Bb", "Em"]) {
          for (const prefer of [undefined, "sharp", "flat"] as const) {
            const opts: { key?: string; prefer?: "sharp" | "flat" } = {};
            if (key) opts.key = key;
            if (prefer) opts.prefer = prefer;
            expect(transposeChord(c, n, opts).chord).not.toMatch(/E#|B#|Cb|Fb/);
          }
        }
      }
    }
  });

  it("respells out-of-key chords (spec example)", () => {
    // F#m7b5 in Bb, shifted away and back, comes back as Gbm7b5.
    const there = transposeChord("F#m7b5", 2, { key: "Bb" }).chord;
    const back = transposeChord(there, -2, { key: "C" }).chord;
    expect(back).toBe("Gbm7b5");
  });
});

describe("round-trip guarantee (24 keys x 11 shifts)", () => {
  const MAJOR_KEYS = [
    "C",
    "Db",
    "D",
    "Eb",
    "E",
    "F",
    "F#",
    "G",
    "Ab",
    "A",
    "Bb",
    "B",
  ];
  const MINOR_KEYS = [
    "Cm",
    "C#m",
    "Dm",
    "D#m",
    "Em",
    "Fm",
    "F#m",
    "Gm",
    "G#m",
    "Am",
    "Bbm",
    "Bm",
  ];
  const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
  const NAT_PC = [0, 2, 4, 5, 7, 9, 11];
  const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
  const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];
  // Excluded: chords whose correct spelling needs these names (see docs/CHORDPRO.md).
  const EXCLUDED = /(^|\/)(E#|B#|Cb|Fb)/;

  function scaleNotes(key: string): string[] {
    const minor = key.endsWith("m");
    const tonic = minor ? key.slice(0, -1) : key;
    const tonicLetter = LETTERS.indexOf(tonic[0] as string);
    const tonicPc = noteToPitchClass(tonic) as number;
    const steps = minor ? MINOR_STEPS : MAJOR_STEPS;
    return steps.map((step, degree) => {
      const li = (tonicLetter + degree) % 7;
      const pc = (tonicPc + step) % 12;
      let acc = pc - (NAT_PC[li] as number);
      if (acc > 6) acc -= 12;
      if (acc < -6) acc += 12;
      expect(Math.abs(acc)).toBeLessThanOrEqual(1);
      return (
        (LETTERS[li] as string) + (acc === 1 ? "#" : acc === -1 ? "b" : "")
      );
    });
  }

  function diatonicChords(key: string): string[] {
    const notes = scaleNotes(key);
    const quality = key.endsWith("m")
      ? ["m", "dim", "", "m", "m", "", ""]
      : ["", "m", "m", "", "", "m", "dim"];
    const triads = notes.map((n, i) => n + (quality[i] as string));
    const slash = notes.flatMap((n, i) =>
      [2, 4].map(
        (k) => `${n}${quality[i] as string}/${notes[(i + k) % 7] as string}`,
      ),
    );
    return [...triads, ...slash].filter(
      (c) => !EXCLUDED.test(c) && !/\/(E#|B#|Cb|Fb)$/.test(c),
    );
  }

  const keys = [...MAJOR_KEYS, ...MINOR_KEYS];
  it("covers the 24 table keys", () => {
    expect(keys).toHaveLength(24);
    // Explicit exclusion list, per key, of chords needing E#/B#/Cb/Fb.
    const excluded = keys.flatMap((k) => {
      const notes = scaleNotes(k);
      return notes
        .filter((n) => /^(E#|B#|Cb|Fb)$/.test(n))
        .map((n) => `${k}:${n}`);
    });
    expect(excluded.sort()).toStrictEqual(["D#m:E#", "F#:E#"]);
  });

  it.each(keys)("round-trip key %s", (key) => {
    const chords = diatonicChords(key);
    expect(chords.length).toBeGreaterThan(10);
    for (let n = 1; n <= 11; n++) {
      const target = transposeKey(key, n) as string;
      for (const c of chords) {
        const up = transposeChord(c, n, { key });
        expect(up.ok).toBe(true);
        const down = transposeChord(up.chord, -n, { key: target });
        expect(down.chord).toBe(c);
      }
    }
  });
});
