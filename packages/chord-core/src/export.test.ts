import { describe, expect, it } from "vitest";
import {
  buildExportDocument,
  buildExportSong,
  directionalCells,
  exportLineDirection,
  exportSongDirection,
  parseSong,
} from "./index";
import type { ExportLine, LyricLine, SongModel } from "./index";

type LyricExport = Extract<ExportLine, { kind: "lyric" }>;

function lyric(
  text: string,
  chords: { index: number; chord: string }[],
  direction?: "rtl" | "ltr",
): LyricLine {
  const l: LyricLine = { kind: "lyric", lyric: text, chords };
  if (direction) l.direction = direction;
  return l;
}

function song(lines: SongModel["lines"], extra: Partial<SongModel> = {}) {
  return { lines, ...extra } satisfies SongModel;
}

function firstLyric(
  s: SongModel,
  opts?: { transpose?: number; capo?: number },
) {
  const out = buildExportSong(s, opts).lines.find((l) => l.kind === "lyric");
  if (!out || out.kind !== "lyric") throw new Error("no lyric line");
  return out;
}

// "שָׁלוֹם עולם": graphemes שָׁ ל וֹ ם " " ע ו ל ם (9)
const NIQQUD = "שָׁלוֹם עולם";

describe("lyric segmentation (R3)", () => {
  it("puts text before the first anchor in a leading chordless segment", () => {
    const l = firstLyric(song([lyric(NIQQUD, [{ index: 3, chord: "Am" }])]));
    expect(l.segments).toEqual([
      { text: "שָׁלוֹ" },
      { chord: "Am", text: "ם עולם" },
    ]);
  });
  it("omits the leading segment when the first anchor is at 0", () => {
    const l = firstLyric(song([lyric(NIQQUD, [{ index: 0, chord: "Am" }])]));
    expect(l.segments).toEqual([{ chord: "Am", text: NIQQUD }]);
  });
  it("emits empty-text segments for anchors sharing an index", () => {
    const l = firstLyric(
      song([
        lyric(NIQQUD, [
          { index: 2, chord: "C" },
          { index: 2, chord: "G" },
          { index: 2, chord: "Am" },
        ]),
      ]),
    );
    expect(l.segments).toEqual([
      { text: "שָׁל" },
      { chord: "C", text: "" },
      { chord: "G", text: "" },
      { chord: "Am", text: "וֹם עולם" },
    ]);
  });
  it("gives an anchor at the grapheme count an empty text", () => {
    const l = firstLyric(song([lyric(NIQQUD, [{ index: 9, chord: "F" }])]));
    expect(l.segments.at(-1)).toEqual({ chord: "F", text: "" });
    expect(l.segments[0]).toEqual({ text: NIQQUD });
  });
  it("keeps niqqud on its base letter: cuts only at grapheme boundaries", () => {
    const l = firstLyric(song([lyric(NIQQUD, [{ index: 1, chord: "G" }])]));
    expect(l.segments[0]).toEqual({ text: "שָׁ" });
    expect(l.segments[1]).toEqual({ chord: "G", text: "לוֹם עולם" });
  });
  it("returns one chordless segment when there are no anchors", () => {
    const l = firstLyric(song([lyric(NIQQUD, [])]));
    expect(l.segments).toEqual([{ text: NIQQUD }]);
  });
  it("returns no segments for an empty lyric without anchors", () => {
    expect(firstLyric(song([lyric("", [])])).segments).toEqual([]);
  });
  it("returns only a chord segment for an empty lyric with an anchor", () => {
    const l = firstLyric(song([lyric("", [{ index: 0, chord: "Dm" }])]));
    expect(l.segments).toEqual([{ chord: "Dm", text: "" }]);
  });
  it("concatenates back to the lyric and keeps anchor order", () => {
    const l = firstLyric(
      song([
        lyric(NIQQUD, [
          { index: 0, chord: "A" },
          { index: 4, chord: "B" },
          { index: 4, chord: "C" },
          { index: 9, chord: "D" },
        ]),
      ]),
    );
    expect(l.segments.map((s) => s.text).join("")).toBe(NIQQUD);
    expect(l.segments.flatMap((s) => (s.chord ? [s.chord] : []))).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
  });
});

describe("viewSong integration (R2)", () => {
  const base = song([lyric("שלום", [{ index: 0, chord: "Am" }])], {
    key: "Am",
  });
  it("transposes and applies capo to the chords", () => {
    const l = firstLyric(base, { transpose: 2, capo: 0 });
    expect(l.segments[0]?.chord).toBe("Bm");
    const c = firstLyric(base, { transpose: 0, capo: 2 });
    expect(c.segments[0]?.chord).toBe("Gm");
  });
  it("defaults capo to song.capo and reports effective values", () => {
    const out = buildExportSong({ ...base, capo: 2 });
    expect(out.capo).toBe(2);
    expect(out.transpose).toBe(0);
    expect(out.shapeKey).toBe("Gm");
    expect(out.soundingKey).toBe("Am");
    expect(out.model.lines).toHaveLength(1);
  });
  it("propagates RangeError for out-of-range capo and non-integer transpose", () => {
    expect(() => buildExportSong(base, { capo: 25 })).toThrow(RangeError);
    expect(() => buildExportSong(base, { capo: -1 })).toThrow(RangeError);
    expect(() => buildExportSong(base, { transpose: 1.5 })).toThrow(RangeError);
    expect(() => buildExportSong(base, { capo: 24 })).not.toThrow();
  });
});

describe("direction (R4)", () => {
  const he = "שלום";
  it("exportSongDirection: explicit, first strong lyric, else ltr", () => {
    expect(
      exportSongDirection(song([lyric("abc", [])], { direction: "rtl" })),
    ).toBe("rtl");
    expect(exportSongDirection(song([lyric("12", []), lyric(he, [])]))).toBe(
      "rtl",
    );
    expect(exportSongDirection(song([{ kind: "empty" }]))).toBe("ltr");
  });
  it("exportLineDirection: line override beats song beats auto", () => {
    expect(exportLineDirection(lyric(he, [], "ltr"), "rtl")).toBe("ltr");
    expect(exportLineDirection(lyric("abc", []), "rtl")).toBe("rtl");
    expect(exportLineDirection(lyric(he, []))).toBe("rtl");
    expect(exportLineDirection(lyric("123", []))).toBe("ltr");
  });
  it("lyric lines honour an explicit line direction over the song's", () => {
    const l = firstLyric(song([lyric(he, [], "ltr")], { direction: "rtl" }));
    expect(l.direction).toBe("ltr");
  });
  it("lyric lines use auto direction when the song has none", () => {
    const out = buildExportSong(song([lyric("abc", []), lyric(he, [])]));
    expect(
      out.lines.map((l) => (l.kind === "lyric" ? l.direction : null)),
    ).toEqual(["ltr", "rtl"]);
  });
  it("lyric lines use the explicit song direction, not the resolved one", () => {
    const out = buildExportSong(song([lyric("abc", [])], { direction: "rtl" }));
    expect(out.lines[0]).toMatchObject({ direction: "rtl" });
  });
  it("comment lines follow their own first strong character", () => {
    const out = buildExportSong(
      song(
        [
          { kind: "comment", style: "normal", text: "שוב" },
          { kind: "comment", style: "normal", text: "again" },
          { kind: "comment", style: "normal", text: "123" },
        ],
        { direction: "rtl" },
      ),
    );
    expect(
      out.lines.map((l) => (l.kind === "comment" ? l.direction : null)),
    ).toEqual(["rtl", "ltr", "ltr"]);
  });
  it("section lines use the resolved song direction", () => {
    const out = buildExportSong(
      song([
        { kind: "section", edge: "start", section: "verse" },
        lyric(he, []),
      ]),
    );
    expect(out.lines[0]).toEqual({
      kind: "section",
      label: "verse",
      direction: "rtl",
    });
    expect(out.direction).toBe("rtl");
  });
  it("chord-only lines follow the song direction, ltr when unset", () => {
    const chords: SongModel["lines"][number] = {
      kind: "chords",
      chords: ["Am", "G"],
    };
    expect(
      buildExportSong(song([chords], { direction: "rtl" })).lines[0],
    ).toEqual({
      kind: "chords",
      chords: ["Am", "G"],
      direction: "rtl",
    });
    // no explicit direction, even with a Hebrew lyric elsewhere
    expect(
      buildExportSong(song([chords, lyric(he, [])])).lines[0],
    ).toMatchObject({
      direction: "ltr",
    });
  });
});

describe("line mapping (R5)", () => {
  it("maps kinds and omits meta, remark, directive and section end", () => {
    const parsed = parseSong(
      [
        "{title: שיר}",
        "{artist:  נגן  }",
        "# remark",
        "{foo: bar}",
        "{start_of_verse: בית}",
        "[Am]שלום",
        "{end_of_verse}",
        "{comment: הערה}",
        "{start_of_tab}",
        "e|--0--|",
        "{end_of_tab}",
        "",
        "[Am]x",
      ].join("\n"),
    ).song;
    const out = buildExportSong(parsed);
    expect(out.lines.map((l) => l.kind)).toEqual([
      "section",
      "lyric",
      "comment",
      "section",
      "tab",
      "empty",
      "lyric",
    ]);
    const kinds = out.lines.map((l) => l.kind);
    expect(kinds).not.toContain("meta");
    expect(kinds).not.toContain("remark");
    expect(kinds).not.toContain("directive");
    expect(kinds.filter((k) => k === "section")).toHaveLength(2);
    expect(out.lines[0]).toMatchObject({ kind: "section", label: "בית" });
    expect(out.lines).toContainEqual({ kind: "tab", text: "e|--0--|" });
    expect(out.title).toBe("שיר");
    expect(out.artist).toBe("נגן");
  });
  it("uses the section name when there is no label", () => {
    const out = buildExportSong(
      song([{ kind: "section", edge: "start", section: "chorus" }]),
    );
    expect(out.lines).toEqual([
      { kind: "section", label: "chorus", direction: "ltr" },
    ]);
  });
  it("drops section end lines only", () => {
    const out = buildExportSong(
      song([
        { kind: "section", edge: "end", section: "verse" },
        { kind: "empty" },
      ]),
    );
    expect(out.lines).toEqual([{ kind: "empty" }]);
  });
  it("keeps raw lines", () => {
    const out = buildExportSong(song([{ kind: "raw", text: "{bad" }]));
    expect(out.lines).toEqual([{ kind: "raw", text: "{bad" }]);
  });
  it("drops remark, directive and meta lines", () => {
    const out = buildExportSong(
      song([
        { kind: "remark", text: "x" },
        { kind: "directive", name: "foo" },
        { kind: "meta", name: "album", value: "A" },
      ]),
    );
    expect(out.lines).toEqual([]);
  });
  it("title defaults to empty and artist is omitted when absent or blank", () => {
    const none = buildExportSong(song([]));
    expect(none.title).toBe("");
    expect("artist" in none).toBe(false);
    const blank = buildExportSong(
      song([{ kind: "meta", name: "artist", value: "   " }]),
    );
    expect("artist" in blank).toBe(false);
  });
  it("takes the first artist meta line, trimmed", () => {
    const out = buildExportSong(
      song([
        { kind: "meta", name: "artist", value: "  ראשון " },
        { kind: "meta", name: "artist", value: "שני" },
      ]),
    );
    expect(out.artist).toBe("ראשון");
  });
});

describe("buildExportDocument (R6)", () => {
  const a = song([lyric("שלום", [{ index: 0, chord: "Am" }])], { title: "א" });
  const b = song([lyric("abc", [{ index: 0, chord: "C" }])], { title: "ב" });
  it("keeps entry order and duplicates, with per-entry transpose and capo", () => {
    const doc = buildExportDocument("סט", [
      { song: a, transpose: 2 },
      { song: b },
      { song: a, transpose: 0, capo: 2 },
    ]);
    expect(doc.title).toBe("סט");
    expect(doc.songs.map((s) => s.title)).toEqual(["א", "ב", "א"]);
    expect(doc.songs.map((s) => [s.transpose, s.capo])).toEqual([
      [2, 0],
      [0, 0],
      [0, 2],
    ]);
    expect(doc.songs[0]?.lines[0]).toMatchObject({
      segments: [{ chord: "Bm" }],
    });
    expect(doc.songs[2]?.lines[0]).toMatchObject({
      segments: [{ chord: "Gm" }],
    });
  });
  it("returns an empty song list for no entries", () => {
    expect(buildExportDocument("ריק", [])).toEqual({ title: "ריק", songs: [] });
  });
  it("does not mutate its inputs", () => {
    const entries = [{ song: a, transpose: 3, capo: 1 }, { song: b }];
    const before = structuredClone(entries);
    buildExportDocument("x", entries);
    expect(entries).toEqual(before);
  });
});

function lyricExport(
  text: string,
  chords: [number, string][],
  dir: "rtl" | "ltr",
) {
  const l = firstLyric(
    song(
      [
        lyric(
          text,
          chords.map(([index, chord]) => ({ index, chord })),
        ),
      ],
      {
        direction: dir,
      },
    ),
  );
  return l satisfies LyricExport;
}

describe("directionalCells (R12)", () => {
  it("treats Arabic like Hebrew (rtl)", () => {
    const cells = directionalCells({
      kind: "lyric",
      direction: "rtl",
      segments: [
        { chord: "Am", text: "مرحبا " },
        { chord: "G", text: "عالم" },
      ],
    });
    expect(cells.map((c) => [c.chord, c.text, c.direction])).toEqual([
      ["Am", "مرحبا ", "rtl"],
      ["G", "عالم", "rtl"],
    ]);
  });

  it("splits the mixed_he_en line into single-direction cells", () => {
    const parsed = parseSong(
      "{meta: direction rtl}\n[Am]אנחנו שרים [G]rock and r[F]oll עד הבוקר\n",
    ).song;
    expect(directionalCells(firstLyric(parsed))).toEqual([
      { chord: "Am", text: "אנחנו שרים ", direction: "rtl" },
      { chord: "G", text: "rock and r", direction: "ltr" },
      { chord: "F", text: "oll", direction: "ltr" },
      { text: " עד הבוקר", direction: "rtl" },
    ]);
  });
  it("neutral between different directions takes the line direction", () => {
    const rtl = directionalCells(lyricExport("שלום abc", [], "rtl"));
    expect(rtl).toEqual([
      { text: "שלום ", direction: "rtl" },
      { text: "abc", direction: "ltr" },
    ]);
    const ltr = directionalCells(lyricExport("שלום abc", [], "ltr"));
    expect(ltr).toEqual([
      { text: "שלום", direction: "rtl" },
      { text: " abc", direction: "ltr" },
    ]);
  });
  it("neutral between equal directions joins them, even in the opposite line direction", () => {
    const cells = directionalCells(lyricExport("abc def", [], "rtl"));
    expect(cells).toEqual([{ text: "abc def", direction: "ltr" }]);
    const he = directionalCells(lyricExport("שלום עולם", [], "ltr"));
    expect(he).toEqual([{ text: "שלום עולם", direction: "rtl" }]);
  });
  it("leading and trailing neutrals take the line direction", () => {
    const cells = directionalCells(lyricExport("(abc)", [], "rtl"));
    expect(cells).toEqual([
      { text: "(", direction: "rtl" },
      { text: "abc", direction: "ltr" },
      { text: ")", direction: "rtl" },
    ]);
  });
  it("treats digits as ltr and keeps niqqud with its Hebrew letter", () => {
    const cells = directionalCells(lyricExport("שָׁלוֹם 12", [], "rtl"));
    expect(cells).toEqual([
      { text: "שָׁלוֹם ", direction: "rtl" },
      { text: "12", direction: "ltr" },
    ]);
  });
  it("puts a segment's chord on its first cell only, in logical order", () => {
    const cells = directionalCells(lyricExport("שלום abc", [[0, "Am"]], "rtl"));
    expect(cells).toEqual([
      { chord: "Am", text: "שלום ", direction: "rtl" },
      { text: "abc", direction: "ltr" },
    ]);
    expect(cells.map((c) => c.text).join("")).toBe("שלום abc");
  });
  it("keeps chord cells for empty-text segments", () => {
    const cells = directionalCells(
      lyricExport(
        "שלום",
        [
          [2, "C"],
          [2, "G"],
          [4, "Am"],
        ],
        "rtl",
      ),
    );
    expect(cells.map((c) => [c.chord, c.text])).toEqual([
      [undefined, "של"],
      ["C", ""],
      ["G", "ום"],
      ["Am", ""],
    ]);
  });
  it("returns no cells for an empty line", () => {
    expect(directionalCells(lyricExport("", [], "rtl"))).toEqual([]);
  });
  it("splits rtl_ltr_tail style lines at the Latin tail", () => {
    const cells = directionalCells(
      lyricExport(
        "שיר של אהבה ו" + "hope",
        [
          [0, "Am"],
          [13, "C"],
          [17, "G"],
        ],
        "rtl",
      ),
    );
    expect(cells.map((c) => [c.chord, c.text, c.direction])).toEqual([
      ["Am", "שיר של אהבה ו", "rtl"],
      ["C", "hope", "ltr"],
      ["G", "", "rtl"],
    ]);
  });
});
