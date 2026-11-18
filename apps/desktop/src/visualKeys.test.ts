import { describe, expect, it } from "vitest";
import { parseSong, splitGraphemes } from "chord-core";
import type { SongModel, TextDirection } from "chord-core";
import { loadLibrary } from "./library";
import {
  caretMove,
  graphemeIndexAt,
  initialUi,
  lyricOf,
  neighbourRow,
  lineMap,
  reconcileUi,
  rowClass,
  rowKeys,
  textRows,
  visualOrder,
  visualStep,
} from "./visualKeys";
import type { VisualUi } from "./visualKeys";

function fixture(name: string): SongModel {
  const entry = loadLibrary().find((s) => s.id === `test-songs:${name}`);
  if (entry === undefined) throw new Error(`no fixture ${name}`);
  return entry.song;
}

/** The lyric of the first lyric line of a fixture. */
function firstLyric(name: string): string {
  const line = fixture(name).lines.find((l) => l.kind === "lyric");
  if (line?.kind !== "lyric") throw new Error(`no lyric in ${name}`);
  return line.lyric;
}

const range = (n: number) => Array.from({ length: n + 1 }, (_, i) => i);
const sorted = (list: readonly number[]) => [...list].sort((a, b) => a - b);

const MIXED = splitGraphemes(firstLyric("mixed_he_en"));
/** Grapheme index of the `r` of "rock and roll" on the mixed line. */
const ROCK = 11;

describe("visualOrder", () => {
  it("the mixed fixture line is the 33-grapheme line the cases below assume", () => {
    expect(MIXED).toHaveLength(33);
    expect(MIXED.slice(ROCK, ROCK + 13).join("")).toBe("rock and roll");
    expect(MIXED[21]).toBe("o");
  });

  it("is a permutation of 0..n for Hebrew, niqqud, English and mixed lines", () => {
    const cases: [string, TextDirection][] = [
      [firstLyric("he_plain"), "rtl"],
      [firstLyric("he_niqqud"), "rtl"],
      [firstLyric("en_plain"), "ltr"],
      [firstLyric("en_plain"), "rtl"],
      [firstLyric("mixed_he_en"), "rtl"],
      [firstLyric("mixed_he_en"), "ltr"],
      ["12 abc, שלום! 34", "rtl"],
      ["", "rtl"],
      ["", "ltr"],
    ];
    for (const [lyric, dir] of cases) {
      const graphemes = splitGraphemes(lyric);
      const order = visualOrder(graphemes, dir);
      expect(sorted(order), `${dir}: ${lyric}`).toEqual(
        range(graphemes.length),
      );
    }
  });

  it("is n..0 for a pure Hebrew rtl line, spaces and niqqud included", () => {
    for (const name of ["he_plain", "he_niqqud"]) {
      const graphemes = splitGraphemes(firstLyric(name));
      expect(graphemes.length).toBeGreaterThan(5);
      expect(visualOrder(graphemes, "rtl")).toEqual(
        range(graphemes.length).reverse(),
      );
    }
  });

  it("is 0..n for a pure English ltr line", () => {
    const graphemes = splitGraphemes(firstLyric("en_plain"));
    expect(graphemes.length).toBeGreaterThan(5);
    expect(visualOrder(graphemes, "ltr")).toEqual(range(graphemes.length));
  });

  it("keeps an English phrase left to right inside an rtl line", () => {
    // end, the Hebrew after the phrase, the phrase, the Hebrew before it.
    expect(visualOrder(MIXED, "rtl")).toEqual([
      33,
      ...[32, 31, 30, 29, 28, 27, 26, 25, 24],
      ...[11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
      ...[10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
    ]);
  });

  it("resolves a neutral between two directions to the line direction", () => {
    // "ab" ltr, space (ltr before, rtl after), "שם" rtl.
    const graphemes = splitGraphemes("ab שם");
    expect(visualOrder(graphemes, "ltr")).toEqual([0, 1, 2, 4, 3, 5]);
    expect(visualOrder(graphemes, "rtl")).toEqual([5, 4, 3, 2, 0, 1]);
  });

  it("gives leading and trailing neutrals the line direction", () => {
    // On an rtl line the dots of ".ab." sit outside the ltr run.
    expect(visualOrder(splitGraphemes(".ab."), "rtl")).toEqual([4, 3, 1, 2, 0]);
    expect(visualOrder(splitGraphemes(".ab."), "ltr")).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("visualStep", () => {
  it("left increases the index on Hebrew letters and decreases it in the English phrase", () => {
    expect(visualStep("left", 2, MIXED, "rtl")).toBe(3);
    expect(visualStep("right", 2, MIXED, "rtl")).toBe(1);
    expect(visualStep("left", 21, MIXED, "rtl")).toBe(20);
    expect(visualStep("right", 21, MIXED, "rtl")).toBe(22);
  });

  it("crosses the phrase boundary to the visual neighbour", () => {
    expect(visualStep("left", ROCK, MIXED, "rtl")).toBe(24);
    expect(visualStep("right", 23, MIXED, "rtl")).toBe(10);
  });

  it("twelve right steps from the r of rock visit 12..23 without bouncing", () => {
    const visited: number[] = [];
    let index = ROCK;
    for (let i = 0; i < 12; i++) {
      index = visualStep("right", index, MIXED, "rtl");
      visited.push(index);
    }
    expect(visited).toEqual([12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
  });

  it("is swapped on an English ltr line", () => {
    const graphemes = splitGraphemes("hello world");
    expect(visualStep("left", 3, graphemes, "ltr")).toBe(2);
    expect(visualStep("right", 3, graphemes, "ltr")).toBe(4);
  });

  it("returns the index unchanged at the visual ends", () => {
    expect(visualStep("left", 33, MIXED, "rtl")).toBe(33);
    expect(visualStep("right", 0, MIXED, "rtl")).toBe(0);
    const graphemes = splitGraphemes("abc");
    expect(visualStep("left", 0, graphemes, "ltr")).toBe(0);
    expect(visualStep("right", 3, graphemes, "ltr")).toBe(3);
  });

  it("clamps an index outside 0..n first", () => {
    const graphemes = splitGraphemes("abc");
    expect(visualStep("left", 99, graphemes, "ltr")).toBe(2);
    expect(visualStep("right", 99, graphemes, "ltr")).toBe(3);
    expect(visualStep("right", -5, graphemes, "ltr")).toBe(1);
    expect(visualStep("left", -5, graphemes, "ltr")).toBe(0);
  });
});

describe("caretMove", () => {
  it("33 ArrowLeft steps from 0 visit every position of the mixed line once", () => {
    const visited = [0];
    let caret = 0;
    for (let i = 0; i < 33; i++) {
      caret = caretMove("ArrowLeft", caret, MIXED, "rtl");
      visited.push(caret);
    }
    expect(new Set(visited).size).toBe(34);
    expect(sorted(visited)).toEqual(range(33));
    expect(caret).toBe(33);
    // A 34th step stops at the visual end.
    expect(caretMove("ArrowLeft", caret, MIXED, "rtl")).toBe(33);
  });

  it("ArrowLeft / ArrowRight go through visualStep", () => {
    const hebrew = splitGraphemes(firstLyric("he_plain"));
    expect(caretMove("ArrowLeft", 0, hebrew, "rtl")).toBe(1);
    expect(caretMove("ArrowRight", 1, hebrew, "rtl")).toBe(0);
    const english = splitGraphemes("hello");
    expect(caretMove("ArrowRight", 0, english, "ltr")).toBe(1);
    expect(caretMove("ArrowLeft", 1, english, "ltr")).toBe(0);
  });

  it("Home is 0 and End is the grapheme count in both directions", () => {
    expect(caretMove("Home", 7, MIXED, "rtl")).toBe(0);
    expect(caretMove("End", 7, MIXED, "rtl")).toBe(33);
    expect(caretMove("Home", 2, splitGraphemes("abc"), "ltr")).toBe(0);
    expect(caretMove("End", 0, splitGraphemes("abc"), "ltr")).toBe(3);
  });
});

describe("graphemeIndexAt", () => {
  it("counts whole graphemes, not code units, on a niqqud line", () => {
    const lyric = firstLyric("he_niqqud");
    const graphemes = splitGraphemes(lyric);
    const first = graphemes[0] ?? "";
    const second = graphemes[1] ?? "";
    // The first grapheme is a letter with two marks.
    expect(first.length).toBe(3);
    const offset = first.length + second.length;
    expect(offset).toBeGreaterThan(2);
    expect(graphemeIndexAt(lyric, offset)).toBe(2);
    expect(graphemeIndexAt(lyric, lyric.length)).toBe(graphemes.length);
  });

  it("does not count a grapheme the offset is inside of", () => {
    const lyric = firstLyric("he_niqqud");
    expect(graphemeIndexAt(lyric, 0)).toBe(0);
    expect(graphemeIndexAt(lyric, 1)).toBe(0);
    expect(graphemeIndexAt(lyric, 2)).toBe(0);
    expect(graphemeIndexAt(lyric, 3)).toBe(1);
  });

  it("equals the offset on plain ASCII and handles the ends", () => {
    expect(graphemeIndexAt("hello", 0)).toBe(0);
    expect(graphemeIndexAt("hello", 3)).toBe(3);
    expect(graphemeIndexAt("hello", 5)).toBe(5);
    expect(graphemeIndexAt("hello", 50)).toBe(5);
    expect(graphemeIndexAt("", 0)).toBe(0);
  });
});

describe("row helpers", () => {
  const song = parseSong(
    "{title: T}\nfirst\n\n[Am] [G]\n{comment: c}\nlast\n",
  ).song;

  it("the sample song has the kinds the cases assume", () => {
    expect(song.lines.map((l) => l.kind)).toEqual([
      "meta",
      "lyric",
      "empty",
      "chords",
      "comment",
      "lyric",
    ]);
  });

  it("rowClass: text for lyric, empty and the phantom row; chords; otherwise null", () => {
    expect(range(7).map((i) => rowClass(song, i))).toEqual([
      null,
      "text",
      "text",
      "chords",
      null,
      "text",
      "text",
      null,
    ]);
    expect(rowClass(song, -1)).toBeNull();
  });

  it("textRows lists the wrapper rows, the phantom row last", () => {
    expect(textRows(song)).toEqual([1, 2, 5, 6]);
    expect(textRows({ lines: [] })).toEqual([0]);
  });

  it("neighbourRow skips rows without a wrapper and stops at the ends", () => {
    expect(neighbourRow(song, 2, 1)).toBe(5);
    expect(neighbourRow(song, 5, -1)).toBe(2);
    expect(neighbourRow(song, 5, 1)).toBe(6);
    expect(neighbourRow(song, 6, 1)).toBeUndefined();
    expect(neighbourRow(song, 1, -1)).toBeUndefined();
  });

  it("lyricOf is the lyric of a lyric line and empty otherwise", () => {
    expect(lyricOf(song.lines[1])).toBe("first");
    expect(lyricOf(song.lines[2])).toBe("");
    expect(lyricOf(song.lines[3])).toBe("");
    expect(lyricOf(undefined)).toBe("");
  });
});

describe("reconcileUi", () => {
  const song = parseSong("one\n[Am]t[G]wo\n{comment: c}\n").song;
  const base = (patch: Partial<VisualUi>): VisualUi => ({
    ...initialUi(),
    ...patch,
  });

  it("applies a pending lyric-edit target and clears the pending focus", () => {
    const next = reconcileUi(
      base({ seq: 4, pending: { kind: "edit", line: 1, caret: 2 } }),
      song,
    );
    expect(next.edit).toEqual({ seq: 5, line: 1, kind: "text", caret: 2 });
    expect(next.pending).toBeNull();
    // The phantom row is a valid target; a comment row is not.
    expect(
      reconcileUi(base({ pending: { kind: "edit", line: 3, caret: 0 } }), song)
        .edit?.line,
    ).toBe(3);
    expect(
      reconcileUi(base({ pending: { kind: "edit", line: 2, caret: 0 } }), song)
        .edit,
    ).toBeNull();
  });

  it("leaves lyric-edit mode when the song changes without a target", () => {
    const next = reconcileUi(
      base({ edit: { seq: 1, line: 0, kind: "text", caret: 0 } }),
      song,
    );
    expect(next.edit).toBeNull();
  });

  it("resets indices that point at a missing row or a row of another kind", () => {
    const next = reconcileUi(
      base({
        focused: 2,
        lastRow: 9,
        caret: { line: 2, index: 1 },
        picker: { seq: 1, line: 2, kind: "add", index: 0 },
      }),
      song,
    );
    expect(next.focused).toBeNull();
    expect(next.lastRow).toBeNull();
    expect(next.caret).toBeNull();
    expect(next.picker).toBeNull();
  });

  it("keeps valid indices and clamps the caret to the line", () => {
    const next = reconcileUi(
      base({
        focused: 0,
        lastRow: 3,
        caret: { line: 0, index: 40 },
        picker: { seq: 1, line: 1, kind: "chord", anchor: 1 },
      }),
      song,
    );
    expect(next.focused).toBe(0);
    expect(next.lastRow).toBe(3);
    expect(next.caret).toEqual({ line: 0, index: 3 });
    expect(next.picker).toEqual({ seq: 1, line: 1, kind: "chord", anchor: 1 });
  });

  it("closes a chord picker whose anchor no longer exists", () => {
    const picker = { seq: 1, line: 1, kind: "chord", anchor: 2 } as const;
    expect(reconcileUi(base({ picker }), song).picker).toBeNull();
    expect(
      reconcileUi(base({ picker: { ...picker, line: 0, anchor: 0 } }), song)
        .picker,
    ).toBeNull();
  });

  it("follows a moved chord to the last anchor at its new index", () => {
    // G moved onto the index of F: chord-core lists it after F.
    const moved = parseSong("a[F][G]bc\n").song;
    const next = reconcileUi(
      base({
        picker: { seq: 7, line: 0, kind: "chord", anchor: 0 },
        pending: { kind: "anchor", index: 1, chord: "G" },
      }),
      moved,
    );
    expect(next.picker).toEqual({ seq: 7, line: 0, kind: "chord", anchor: 1 });
    // Another chord at that place: the picker closes instead of switching.
    const other = reconcileUi(
      base({
        picker: { seq: 7, line: 0, kind: "chord", anchor: 0 },
        pending: { kind: "anchor", index: 1, chord: "C" },
      }),
      moved,
    );
    expect(other.picker).toBeNull();
  });
});

describe("rowKeys", () => {
  const keysOf = (text: string) => rowKeys(parseSong(text).song);

  it("numbers the rendered rows, the phantom row last", () => {
    expect(keysOf("one\n\n{comment: c}\ntwo\n")).toEqual([0, 1, 2, 3, 4]);
    expect(rowKeys({ lines: [] })).toEqual([0]);
  });

  it("gives every row the same key when meta lines are added or removed", () => {
    const plain = keysOf("one\ntwo\n");
    const titled = keysOf("{title: T}\none\ntwo\n");
    const both = keysOf("{title: T}\n{artist: A}\none\n{key: C}\ntwo\n");
    expect(plain).toEqual([0, 1, 2]);
    expect(titled.slice(1)).toEqual(plain);
    expect(both).toEqual([-1, -1, 0, -1, 1, 2]);
  });
});

describe("lineMap", () => {
  const song = (text: string) => parseSong(text).song;
  const mapped = (before: string, after: string) => {
    const prev = song(before);
    const map = lineMap(prev, song(after));
    return range(prev.lines.length).map((i) => map(i));
  };

  it("shifts the lines after an inserted line, the phantom row included", () => {
    expect(mapped("one\ntwo\n", "{title: T}\none\ntwo\n")).toEqual([1, 2, 3]);
    expect(
      mapped("{title: T}\none\ntwo\n", "{title: T}\n{artist: A}\none\ntwo\n"),
    ).toEqual([0, 2, 3, 4]);
  });

  it("shifts the lines after a removed line and drops the removed one", () => {
    expect(mapped("{artist: A}\none\ntwo\n", "one\ntwo\n")).toEqual([
      null,
      0,
      1,
      2,
    ]);
    expect(mapped("one\ntwo\nthree\n", "one\nthree\n")).toEqual([
      0,
      null,
      1,
      2,
    ]);
  });

  it("keeps the place of changed lines when the line count is the same", () => {
    expect(mapped("{title: T}\none\ntwo\n", "{title: U}\none\ntwo\n")).toEqual([
      0, 1, 2, 3,
    ]);
    expect(mapped("[C]one\n[G]two\n", "[D]one\n[A]two\n")).toEqual([0, 1, 2]);
  });

  it("is the identity for an unchanged song and null outside 0..count", () => {
    const prev = song("one\ntwo\n");
    const map = lineMap(prev, song("one\ntwo\n"));
    expect([0, 1, 2].map((i) => map(i))).toEqual([0, 1, 2]);
    expect(map(3)).toBeNull();
    expect(map(-1)).toBeNull();
    expect(map(0.5)).toBeNull();
  });
});

describe("reconcileUi after a change from outside", () => {
  const prev = parseSong("one\nt[G]wo\n").song;
  const next = parseSong("{artist: A}\none\nt[G]wo\n").song;
  const state = (patch: Partial<VisualUi>): VisualUi => ({
    ...initialUi(),
    ...patch,
  });
  const ui = state({
    focused: 1,
    lastRow: 1,
    caret: { line: 1, index: 2 },
    picker: { seq: 3, line: 1, kind: "chord", anchor: 0 },
  });

  it("moves every row index along with its line", () => {
    const out = reconcileUi(ui, next, prev);
    expect(out.focused).toBe(2);
    expect(out.lastRow).toBe(2);
    expect(out.caret).toEqual({ line: 2, index: 2 });
    expect(out.picker).toEqual({ seq: 3, line: 2, kind: "chord", anchor: 0 });
  });

  it("moves them back when the line is removed again", () => {
    const out = reconcileUi(reconcileUi(ui, next, prev), prev, next);
    expect(out.focused).toBe(1);
    expect(out.lastRow).toBe(1);
    expect(out.caret).toEqual({ line: 1, index: 2 });
    expect(out.picker).toEqual({ seq: 3, line: 1, kind: "chord", anchor: 0 });
  });

  it("resets the indices of a line that is gone", () => {
    const gone = parseSong("one\n").song;
    const out = reconcileUi(ui, gone, prev);
    expect(out.focused).toBeNull();
    expect(out.lastRow).toBeNull();
    expect(out.caret).toBeNull();
    expect(out.picker).toBeNull();
  });

  it("moves the indices along for the editor's own edit as well and clears the mark", () => {
    const out = reconcileUi({ ...ui, own: true }, next, prev);
    expect(out.own).toBe(false);
    expect(out.focused).toBe(2);
    expect(out.lastRow).toBe(2);
    expect(out.caret).toEqual({ line: 2, index: 2 });
    expect(out.picker).toEqual({ seq: 3, line: 2, kind: "chord", anchor: 0 });
  });
});

describe("lineMap for a reorder that keeps the line count", () => {
  const song = (text: string) => parseSong(text).song;
  const mapped = (before: string, after: string) => {
    const prev = song(before);
    const map = lineMap(prev, song(after));
    return range(prev.lines.length).map((i) => map(i));
  };
  const VERSE = "{start_of_verse}\none\n{end_of_verse}\n";
  const CHORUS = "{start_of_chorus}\ntwo\n{end_of_chorus}\n";

  it("maps every line of two swapped sections to its new index", () => {
    expect(mapped(`top\n${VERSE}${CHORUS}end\n`, `top\n${CHORUS}${VERSE}end\n`))
      // top, verse start/one/end, chorus start/two/end, end, phantom
      .toEqual([0, 4, 5, 6, 1, 2, 3, 7, 8]);
  });

  it("maps two swapped lines and keeps a changed line in between", () => {
    expect(mapped("a\nx\nb\n", "b\ny\na\n")).toEqual([2, 1, 0, 3]);
  });

  it("keeps the place of a line whose content is not unique on both sides", () => {
    // Two "a" lines before: neither has a single counterpart.
    expect(mapped("a\na\nb\n", "b\na\na\n")).toEqual([0, 1, 0, 3]);
    // One "a" before, two after.
    expect(mapped("a\nb\nc\n", "c\na\na\n")).toEqual([0, 1, 0, 3]);
    // Two before, one after.
    expect(mapped("a\na\nc\n", "c\na\nb\n")).toEqual([0, 1, 0, 3]);
  });

  it("does not look for a counterpart outside the changed span", () => {
    // "x" also sits in the common prefix; inside the span it is unique.
    expect(mapped("x\nx\nb\nc\n", "x\nb\nx\nd\n")).toEqual([0, 2, 1, 3, 4]);
  });

  it("gives no counterpart when the line count changes", () => {
    expect(mapped("a\nb\nc\n", "b\na\n")).toEqual([null, null, null, 2]);
  });
});

describe("reconcileUi after the editor's own edit", () => {
  const song = (text: string) => parseSong(text).song;
  const own = (patch: Partial<VisualUi>): VisualUi => ({
    ...initialUi(),
    own: true,
    ...patch,
  });

  it("keeps the picker on its line when a line above is removed, and closes it with its line", () => {
    const prev = song("one\ntwo\nthree\nfour\n");
    const picker = { seq: 1, line: 2, kind: "add", index: 0 } as const;
    expect(
      reconcileUi(own({ picker }), song("two\nthree\nfour\n"), prev).picker,
    ).toEqual({ ...picker, line: 1 });
    expect(
      reconcileUi(own({ picker }), song("one\ntwo\nfour\n"), prev).picker,
    ).toBeNull();
  });

  it("keeps the pending lyric-edit target as given", () => {
    const prev = song("one\ntwo\n");
    const out = reconcileUi(
      own({
        lastRow: 1,
        caret: { line: 1, index: 1 },
        pending: { kind: "edit", line: 1, caret: 0 },
      }),
      song("one\n\ntwo\n"),
      prev,
    );
    expect(out.edit).toMatchObject({ line: 1, kind: "text", caret: 0 });
    expect(out.lastRow).toBe(2);
    expect(out.caret).toEqual({ line: 2, index: 1 });
  });

  it("the phantom row keeps its index when the own edit only appends lines", () => {
    const prev = song("one\n");
    const next = song("one\nhello\n");
    const ui = { lastRow: 1, caret: { line: 1, index: 0 } };
    const out = reconcileUi(own(ui), next, prev);
    expect(out.lastRow).toBe(1);
    expect(out.caret).toEqual({ line: 1, index: 0 });
    // From outside the phantom row stays the row after the last line.
    const outside = reconcileUi(own({ ...ui, own: false }), next, prev);
    expect(outside.lastRow).toBe(2);
    expect(outside.caret).toEqual({ line: 2, index: 0 });
    // An own edit that inserts above the last line shifts it as usual.
    expect(reconcileUi(own(ui), song("zero\none\n"), prev).lastRow).toBe(2);
  });
});
