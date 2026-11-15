import { describe, expect, it } from "vitest";
import type { SongModel } from "./model";
import { transposeSong, viewSong } from "./transpose";

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

function song(extra: Partial<SongModel> = {}): SongModel {
  return {
    title: "T",
    key: "G",
    capo: 2,
    lines: [
      { kind: "meta", name: "title", value: "T" },
      { kind: "meta", name: "key", value: "G" },
      { kind: "meta", name: "capo", value: "2" },
      { kind: "directive", name: "new_key", value: "Am" },
      { kind: "directive", name: "new_key" },
      { kind: "directive", name: "other", value: "G" },
      { kind: "section", edge: "start", section: "verse", label: "V1" },
      {
        kind: "lyric",
        lyric: "שלום עולם",
        chords: [
          { index: 0, chord: "G" },
          { index: 4, chord: "N.C." },
          { index: 5, chord: "Em7/D" },
        ],
        direction: "rtl",
      },
      { kind: "chords", chords: ["C", "x y", "D/F#"] },
      { kind: "comment", style: "box", text: "Am" },
      { kind: "tab", text: "e|--0--|" },
      { kind: "remark", text: " G" },
      { kind: "raw", text: "[G" },
      { kind: "empty" },
      { kind: "section", edge: "end", section: "verse" },
    ],
    ...extra,
  };
}

describe("transposeSong", () => {
  it("transposes anchors and chord-only lines with key-aware spelling", () => {
    const r = transposeSong(deepFreeze(song()), 2);
    const lyric = r.song.lines[7];
    expect(lyric).toMatchObject({ kind: "lyric" });
    if (lyric?.kind === "lyric") {
      expect(lyric.chords.map((c) => c.chord)).toStrictEqual([
        "A",
        "N.C.",
        "F#m7/E",
      ]);
      expect(lyric.lyric).toBe("שלום עולם");
      expect(lyric.direction).toBe("rtl");
    }
    expect(r.song.lines[8]).toStrictEqual({
      kind: "chords",
      chords: ["D", "x y", "E/G#"],
    });
  });

  it("rewrites song.key, meta key and new_key directive; leaves the rest alone", () => {
    const input = song();
    const r = transposeSong(input, 2);
    expect(r.song.key).toBe("A");
    expect(r.song.capo).toBe(2);
    expect(r.song.title).toBe("T");
    expect(r.song.lines[1]).toStrictEqual({
      kind: "meta",
      name: "key",
      value: "A",
    });
    expect(r.song.lines[2]).toStrictEqual({
      kind: "meta",
      name: "capo",
      value: "2",
    });
    expect(r.song.lines[3]).toStrictEqual({
      kind: "directive",
      name: "new_key",
      value: "Bm",
    });
    expect(r.song.lines[4]).toStrictEqual({
      kind: "directive",
      name: "new_key",
    });
    expect(r.song.lines[5]).toStrictEqual(input.lines[5]);
    for (const i of [0, 6, 9, 10, 11, 12, 13, 14]) {
      expect(r.song.lines[i]).toStrictEqual(input.lines[i]);
    }
  });

  it("leaves unparseable key values unchanged", () => {
    const input = song({ key: "Hm" });
    input.lines[1] = { kind: "meta", name: "key", value: "Hm" };
    const r = transposeSong(input, 3);
    expect(r.song.key).toBe("Hm");
    expect(r.song.lines[1]).toStrictEqual({
      kind: "meta",
      name: "key",
      value: "Hm",
    });
  });

  it("reports one unknown-chord diagnostic per bad chord with 1-based positions", () => {
    const r = transposeSong(song(), 2);
    expect(r.diagnostics).toStrictEqual([
      {
        line: 8,
        column: 2,
        code: "unknown-chord",
        message: 'Unrecognized chord "N.C."',
      },
      {
        line: 9,
        column: 2,
        code: "unknown-chord",
        message: 'Unrecognized chord "x y"',
      },
    ]);
  });

  it("does not mutate a deep-frozen input and returns a new model", () => {
    const input = deepFreeze(song());
    const before = structuredClone(input);
    const r = transposeSong(input, 5);
    expect(input).toStrictEqual(before);
    expect(r.song).not.toBe(input);
    expect(r.song.lines).not.toBe(input.lines);
  });

  it("returns a deep-equal model for n = 0 mod 12", () => {
    for (const n of [0, 12, -24]) {
      const input = song();
      const r = transposeSong(input, n);
      expect(r.song).toStrictEqual(input);
      expect(r.song).not.toBe(input);
    }
  });

  it("honours prefer when there is no key", () => {
    const input: SongModel = { lines: [{ kind: "chords", chords: ["C"] }] };
    expect(transposeSong(input, 1).song.lines[0]).toStrictEqual({
      kind: "chords",
      chords: ["C#"],
    });
    expect(transposeSong(input, 3).song.lines[0]).toStrictEqual({
      kind: "chords",
      chords: ["Eb"],
    });
    expect(
      transposeSong(input, 1, { prefer: "flat" }).song.lines[0],
    ).toStrictEqual({
      kind: "chords",
      chords: ["Db"],
    });
  });

  it("applies prefer to tie keys", () => {
    const input = song({ key: "C" });
    input.lines[1] = { kind: "meta", name: "key", value: "C" };
    expect(transposeSong(input, 6).song.key).toBe("F#");
    expect(transposeSong(input, 6, { prefer: "flat" }).song.key).toBe("Gb");
  });

  it("throws RangeError for a non-integer shift", () => {
    expect(() => transposeSong(song(), 0.5)).toThrow(RangeError);
    expect(() => transposeSong(song(), Number.NaN)).toThrow(RangeError);
  });
});

describe("viewSong", () => {
  function chordsSong(
    chords: string[],
    extra: Partial<SongModel> = {},
  ): SongModel {
    return { lines: [{ kind: "chords", chords }], ...extra };
  }
  const chordsOf = (r: { song: SongModel }): string[] => {
    const l = r.song.lines[0];
    return l?.kind === "chords" ? l.chords : [];
  };

  it("key G, capo 2: shapes = sounding - 2", () => {
    const r = viewSong(chordsSong(["A", "C#m"], { key: "G" }), { capo: 2 });
    expect(chordsOf(r)).toStrictEqual(["G", "Bm"]);
    expect(r.soundingKey).toBe("G");
    expect(r.shapeKey).toBe("F");
    expect(r.capo).toBe(2);
  });

  it("key Bb, transpose +2, capo 3", () => {
    const r = viewSong(chordsSong(["Bb"], { key: "Bb" }), {
      transpose: 2,
      capo: 3,
    });
    expect(chordsOf(r)).toStrictEqual(["A"]);
    expect(r.soundingKey).toBe("C");
    expect(r.shapeKey).toBe("A");
  });

  it("no key, capo 1", () => {
    const r = viewSong(chordsSong(["C#", "Eb"]), { capo: 1 });
    expect(chordsOf(r)).toStrictEqual(["C", "D"]);
    expect(r).not.toHaveProperty("soundingKey");
    expect(r).not.toHaveProperty("shapeKey");
  });

  it("defaults capo to song.capo and transpose to 0", () => {
    const r = viewSong(chordsSong(["A"], { key: "G", capo: 2 }));
    expect(r.capo).toBe(2);
    expect(chordsOf(r)).toStrictEqual(["G"]);
    expect(
      viewSong(chordsSong(["A"], { key: "G", capo: 2 }), { capo: 0 }).capo,
    ).toBe(0);
    expect(viewSong(chordsSong(["A"])).capo).toBe(0);
  });

  it("omits keys when song.key does not parse", () => {
    const r = viewSong(chordsSong(["A"], { key: "Hm" }), { capo: 1 });
    expect(r).not.toHaveProperty("soundingKey");
    expect(r).not.toHaveProperty("shapeKey");
    expect(chordsOf(r)).toStrictEqual(["Ab"]);
  });

  it("does not rewrite meta lines or song.key", () => {
    const input = song();
    const r = viewSong(input, { transpose: 3, capo: 1 });
    expect(r.song.key).toBe("G");
    expect(r.song.capo).toBe(2);
    for (const i of [0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14]) {
      expect(r.song.lines[i]).toStrictEqual(input.lines[i]);
    }
  });

  it("passes N.C. through with an unknown-chord diagnostic", () => {
    const r = viewSong(song(), { capo: 0 });
    expect(r.diagnostics.map((d) => [d.line, d.column, d.code])).toStrictEqual([
      [8, 2, "unknown-chord"],
      [9, 2, "unknown-chord"],
    ]);
    const lyric = r.song.lines[7];
    if (lyric?.kind === "lyric") expect(lyric.chords[1]?.chord).toBe("N.C.");
  });

  it("does not mutate a deep-frozen input", () => {
    const input = deepFreeze(song());
    const before = structuredClone(input);
    const r = viewSong(input, { transpose: 4, capo: 3 });
    expect(input).toStrictEqual(before);
    expect(r.song).not.toBe(input);
  });

  it("leaves chords verbatim when transpose equals capo", () => {
    expect(
      chordsOf(viewSong(chordsSong(["Cb", "E#"]), { transpose: 2, capo: 2 })),
    ).toStrictEqual(["Cb", "E#"]);
  });

  it("throws RangeError for invalid capo or transpose", () => {
    const s = chordsSong(["C"]);
    for (const capo of [-1, 25, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => viewSong(s, { capo })).toThrow(RangeError);
    }
    for (const transpose of [0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => viewSong(s, { transpose })).toThrow(RangeError);
    }
    expect(() => viewSong(chordsSong(["C"], { capo: 30 }))).toThrow(RangeError);
    expect(() => viewSong(s, { capo: 24 })).not.toThrow();
  });
});
