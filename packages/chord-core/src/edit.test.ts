import { describe, expect, it } from "vitest";
import { readEditCases, readFixture } from "test-fixtures";
import {
  applyEdit,
  applyEdits,
  isValidChordText,
  listSections,
  parseChord,
  parseSong,
  serializeSong,
  songChords,
  splitGraphemes,
  suggestChords,
  type EditOp,
  type LyricLine,
  type SongModel,
} from "./index";

const OP_TYPES = [
  "setLyric",
  "addChord",
  "setChord",
  "removeChord",
  "moveChord",
  "insertLine",
  "removeLine",
  "splitLine",
  "joinLines",
  "setChordsLine",
  "setComment",
  "setMeta",
  "addSection",
  "renameSection",
  "moveSection",
  "removeSection",
  "transpose",
];

function song(text: string): SongModel {
  return parseSong(text).song;
}

function lyricAt(model: SongModel, index: number): LyricLine {
  const line = model.lines[index];
  if (line?.kind !== "lyric") {
    throw new Error(`line ${String(index)} is ${String(line?.kind)}`);
  }
  return line;
}

/** Apply ops and return the resulting text. */
function edit(text: string, ...ops: EditOp[]): string {
  return applyEdits(song(text), ops).text;
}

/** A deliberately ill-typed op, as a UI or JSON file could produce at runtime. */
function loose(op: Record<string, unknown>): EditOp {
  return op as unknown as EditOp;
}

const CASES = readEditCases();

describe("golden edit cases", () => {
  it.each(CASES)("$name", ({ fixture, ops, expected }) => {
    const input = song(readFixture(fixture));
    const snapshot = structuredClone(input);
    const result = applyEdits(input, ops as EditOp[]);
    expect(result.text).toBe(expected);
    expect(result.changed).toBe(true);
    // The returned song is always a fresh parse of the returned text.
    expect(result.song).toEqual(parseSong(result.text).song);
    // Purity: the input model is untouched.
    expect(input).toEqual(snapshot);
  });

  it.each(CASES)("$name: every step is a fresh parse", ({ fixture, ops }) => {
    let current = song(readFixture(fixture));
    for (const op of ops as EditOp[]) {
      const step = applyEdit(current, op);
      expect(step.changed).toBe(true);
      expect(step.song).toEqual(parseSong(step.text).song);
      expect(serializeSong(step.song)).toBe(step.text);
      current = step.song;
    }
  });

  it("covers every EditOp type", () => {
    const seen = new Set(
      CASES.flatMap((c) => c.ops.map((op) => (op as { type: string }).type)),
    );
    expect([...seen].sort()).toEqual([...OP_TYPES].sort());
    expect(OP_TYPES).toHaveLength(17);
  });

  it("covers the Hebrew, niqqud, mixed and structural fixtures", () => {
    const count = (name: string): number =>
      CASES.filter((c) => c.fixture === name).length;
    expect(count("he_plain")).toBeGreaterThanOrEqual(3);
    expect(count("he_niqqud")).toBeGreaterThanOrEqual(2);
    expect(count("mixed_he_en")).toBeGreaterThanOrEqual(2);
    expect(count("sections_he")).toBeGreaterThanOrEqual(2);
    expect(count("en_plain")).toBeGreaterThanOrEqual(1);
    expect(count("chord_only_line")).toBeGreaterThanOrEqual(1);
    const tab = CASES.filter((c) => c.fixture === "tab_block");
    expect(
      tab.some((c) =>
        c.ops.some((op) =>
          ["moveSection", "removeSection"].includes(
            (op as { type: string }).type,
          ),
        ),
      ),
    ).toBe(true);
  });
});

// 0 title, 1 key, 2 empty, 3 lyric, 4 chords, 5 comment, 6 start verse,
// 7 lyric, 8 end verse, 9 start tab, 10 tab, 11 end tab, 12 remark,
// 13 start chorus (unclosed). 14 lines.
const BASE = [
  "{title: T}",
  "{key: G}",
  "",
  "[Am]abc [G]def",
  "[C] [D]",
  "{comment_italic: note}",
  "{start_of_verse: V1}",
  "line",
  "{end_of_verse}",
  "{start_of_tab}",
  "e|--|",
  "{end_of_tab}",
  "# remark",
  "{start_of_chorus}",
  "",
].join("\n");

const INVALID: [string, EditOp][] = [
  // line index rules
  ["setLyric line -1", { type: "setLyric", line: -1, text: "x" }],
  ["setLyric line 1.5", { type: "setLyric", line: 1.5, text: "x" }],
  ["setLyric line NaN", { type: "setLyric", line: NaN, text: "x" }],
  ["setLyric line length + 1", { type: "setLyric", line: 15, text: "x" }],
  ["setLyric line Infinity", { type: "setLyric", line: Infinity, text: "x" }],
  [
    "addChord line length + 1",
    { type: "addChord", line: 15, index: 0, chord: "A" },
  ],
  ["addChord line -1", { type: "addChord", line: -1, index: 0, chord: "A" }],
  [
    "setChord line length",
    { type: "setChord", line: 14, anchor: 0, chord: "A" },
  ],
  ["removeChord line length", { type: "removeChord", line: 14, anchor: 0 }],
  [
    "moveChord line length",
    { type: "moveChord", line: 14, anchor: 0, index: 0 },
  ],
  ["removeLine line length", { type: "removeLine", line: 14 }],
  ["removeLine line -1", { type: "removeLine", line: -1 }],
  ["removeLine line 2.5", { type: "removeLine", line: 2.5 }],
  ["splitLine line length", { type: "splitLine", line: 14, index: 0 }],
  ["joinLines line length", { type: "joinLines", line: 14 }],
  [
    "setChordsLine line length",
    { type: "setChordsLine", line: 14, chords: ["A"] },
  ],
  ["setComment line length", { type: "setComment", line: 14, text: "x" }],
  // setLyric line kinds
  ["setLyric on meta", { type: "setLyric", line: 0, text: "x" }],
  ["setLyric on comment", { type: "setLyric", line: 5, text: "x" }],
  ["setLyric on section", { type: "setLyric", line: 6, text: "x" }],
  ["setLyric on tab", { type: "setLyric", line: 10, text: "x" }],
  ["setLyric on remark", { type: "setLyric", line: 12, text: "x" }],
  // addChord
  [
    "addChord on chords line",
    { type: "addChord", line: 4, index: 0, chord: "A" },
  ],
  ["addChord on meta", { type: "addChord", line: 0, index: 0, chord: "A" }],
  ["addChord empty chord", { type: "addChord", line: 3, index: 0, chord: "" }],
  [
    "addChord blank chord",
    { type: "addChord", line: 3, index: 0, chord: "  " },
  ],
  [
    "addChord chord with [",
    { type: "addChord", line: 3, index: 0, chord: "A[" },
  ],
  [
    "addChord chord with ]",
    { type: "addChord", line: 3, index: 0, chord: "]A" },
  ],
  [
    "addChord chord with LF",
    { type: "addChord", line: 3, index: 0, chord: "A\nB" },
  ],
  [
    "addChord chord with CR",
    { type: "addChord", line: 3, index: 0, chord: "A\rB" },
  ],
  ["addChord index NaN", { type: "addChord", line: 3, index: NaN, chord: "A" }],
  // setChord / removeChord / moveChord
  [
    "setChord on chords line",
    { type: "setChord", line: 4, anchor: 0, chord: "A" },
  ],
  ["setChord anchor -1", { type: "setChord", line: 3, anchor: -1, chord: "A" }],
  [
    "setChord anchor = length",
    { type: "setChord", line: 3, anchor: 2, chord: "A" },
  ],
  [
    "setChord anchor 0.5",
    { type: "setChord", line: 3, anchor: 0.5, chord: "A" },
  ],
  [
    "setChord anchor NaN",
    { type: "setChord", line: 3, anchor: NaN, chord: "A" },
  ],
  [
    "setChord invalid chord",
    { type: "setChord", line: 3, anchor: 0, chord: "[" },
  ],
  [
    "setChord blank chord",
    { type: "setChord", line: 3, anchor: 0, chord: " " },
  ],
  ["removeChord anchor = length", { type: "removeChord", line: 3, anchor: 2 }],
  ["removeChord anchor -1", { type: "removeChord", line: 3, anchor: -1 }],
  ["removeChord anchor 1.5", { type: "removeChord", line: 3, anchor: 1.5 }],
  ["removeChord on empty line", { type: "removeChord", line: 2, anchor: 0 }],
  ["removeChord on chords line", { type: "removeChord", line: 4, anchor: 0 }],
  [
    "moveChord anchor = length",
    { type: "moveChord", line: 3, anchor: 2, index: 0 },
  ],
  [
    "moveChord index NaN",
    { type: "moveChord", line: 3, anchor: 0, index: NaN },
  ],
  [
    "moveChord on chords line",
    { type: "moveChord", line: 4, anchor: 0, index: 0 },
  ],
  // insertLine
  ["insertLine at 1.5", { type: "insertLine", at: 1.5 }],
  ["insertLine at NaN", { type: "insertLine", at: NaN }],
  ["insertLine at Infinity", { type: "insertLine", at: Infinity }],
  // removeLine
  ["removeLine on section start", { type: "removeLine", line: 6 }],
  ["removeLine on section end", { type: "removeLine", line: 8 }],
  ["removeLine on unclosed start", { type: "removeLine", line: 13 }],
  // splitLine
  ["splitLine on empty", { type: "splitLine", line: 2, index: 0 }],
  ["splitLine on chords", { type: "splitLine", line: 4, index: 0 }],
  ["splitLine on meta", { type: "splitLine", line: 0, index: 0 }],
  ["splitLine index NaN", { type: "splitLine", line: 3, index: NaN }],
  // joinLines
  ["joinLines last line", { type: "joinLines", line: 13 }],
  ["joinLines lyric + chords", { type: "joinLines", line: 3 }],
  ["joinLines lyric + section", { type: "joinLines", line: 7 }],
  ["joinLines meta + empty", { type: "joinLines", line: 1 }],
  ["joinLines line -1", { type: "joinLines", line: -1 }],
  // setChordsLine
  ["setChordsLine on lyric", { type: "setChordsLine", line: 3, chords: ["A"] }],
  [
    "setChordsLine inner space",
    { type: "setChordsLine", line: 4, chords: ["A m"] },
  ],
  [
    "setChordsLine inner tab",
    { type: "setChordsLine", line: 4, chords: ["C", "A\tm"] },
  ],
  ["setChordsLine with [", { type: "setChordsLine", line: 4, chords: ["A["] }],
  ["setChordsLine with ]", { type: "setChordsLine", line: 4, chords: ["A]"] }],
  [
    "setChordsLine inner LF",
    { type: "setChordsLine", line: 4, chords: ["A\nB"] },
  ],
  // setComment
  ["setComment on lyric", { type: "setComment", line: 3, text: "x" }],
  ["setComment on meta", { type: "setComment", line: 0, text: "x" }],
  // setMeta
  [
    "setMeta subtitle",
    loose({ type: "setMeta", name: "subtitle", value: "x" }),
  ],
  [
    "setMeta direction",
    loose({ type: "setMeta", name: "direction", value: "rtl" }),
  ],
  ["setMeta Title", loose({ type: "setMeta", name: "Title", value: "x" })],
  ["setMeta empty name", loose({ type: "setMeta", name: "", value: "x" })],
  [
    "setMeta constructor",
    loose({ type: "setMeta", name: "constructor", value: "x" }),
  ],
  [
    "setMeta __proto__",
    loose({ type: "setMeta", name: "__proto__", value: "x" }),
  ],
  [
    "setMeta toString",
    loose({ type: "setMeta", name: "toString", value: "x" }),
  ],
  [
    "setMeta hasOwnProperty",
    loose({ type: "setMeta", name: "hasOwnProperty", value: "" }),
  ],
  // addSection
  ["addSection tab", loose({ type: "addSection", at: 0, section: "tab" })],
  ["addSection intro", loose({ type: "addSection", at: 0, section: "intro" })],
  [
    "addSection constructor",
    loose({ type: "addSection", at: 0, section: "constructor" }),
  ],
  [
    "addSection __proto__",
    loose({ type: "addSection", at: 0, section: "__proto__" }),
  ],
  [
    "addSection toString",
    loose({ type: "addSection", at: 0, section: "toString" }),
  ],
  ["addSection at NaN", { type: "addSection", at: NaN, section: "verse" }],
  // renameSection
  [
    "renameSection not a start",
    { type: "renameSection", line: 7, section: "chorus" },
  ],
  [
    "renameSection on end",
    { type: "renameSection", line: 8, section: "chorus" },
  ],
  [
    "renameSection literal",
    { type: "renameSection", line: 9, section: "chorus" },
  ],
  [
    "renameSection unclosed",
    { type: "renameSection", line: 13, section: "verse" },
  ],
  [
    "renameSection to tab",
    loose({ type: "renameSection", line: 6, section: "tab" }),
  ],
  [
    "renameSection to constructor",
    loose({ type: "renameSection", line: 6, section: "constructor" }),
  ],
  [
    "renameSection to __proto__",
    loose({ type: "renameSection", line: 6, section: "__proto__" }),
  ],
  [
    "renameSection to toString",
    loose({ type: "renameSection", line: 6, section: "toString" }),
  ],
  // moveSection
  ["moveSection first up", { type: "moveSection", line: 6, direction: "up" }],
  [
    "moveSection last down",
    { type: "moveSection", line: 9, direction: "down" },
  ],
  [
    "moveSection not a start",
    { type: "moveSection", line: 7, direction: "down" },
  ],
  ["moveSection unclosed", { type: "moveSection", line: 13, direction: "up" }],
  [
    "moveSection bad direction",
    loose({ type: "moveSection", line: 6, direction: "sideways" }),
  ],
  [
    "moveSection line NaN",
    { type: "moveSection", line: NaN, direction: "down" },
  ],
  // removeSection
  ["removeSection on end", { type: "removeSection", line: 8 }],
  ["removeSection inside", { type: "removeSection", line: 7 }],
  ["removeSection unclosed", { type: "removeSection", line: 13 }],
  ["removeSection line -1", { type: "removeSection", line: -1 }],
  // transpose
  ["transpose 1.5", { type: "transpose", semitones: 1.5 }],
  ["transpose NaN", { type: "transpose", semitones: NaN }],
  ["transpose Infinity", { type: "transpose", semitones: Infinity }],
  // ill-typed values that JSON or a UI bug could deliver
  ["unknown type", loose({ type: "nope" })],
  ["prototype-named type", loose({ type: "constructor" })],
  ["setLyric text not a string", loose({ type: "setLyric", line: 3, text: 5 })],
  [
    "addChord chord not a string",
    loose({ type: "addChord", line: 3, index: 0, chord: null }),
  ],
  [
    "setChordsLine chords not an array",
    loose({ type: "setChordsLine", line: 4, chords: "A" }),
  ],
  [
    "setMeta value not a string",
    loose({ type: "setMeta", name: "title", value: 1 }),
  ],
  ["line as a string", loose({ type: "removeLine", line: "3" })],
];

describe("invalid ops", () => {
  it("the base song has the line kinds the table relies on", () => {
    expect(song(BASE).lines.map((l) => l.kind)).toEqual([
      "meta",
      "meta",
      "empty",
      "lyric",
      "chords",
      "comment",
      "section",
      "lyric",
      "section",
      "section",
      "tab",
      "section",
      "remark",
      "section",
    ]);
    expect(lyricAt(song(BASE), 3).chords).toHaveLength(2);
  });

  it.each(INVALID)("%s returns the input unchanged", (_name, op) => {
    const input = song(BASE);
    const snapshot = structuredClone(input);
    const result = applyEdit(input, op);
    expect(result.song).toBe(input);
    expect(result.changed).toBe(false);
    expect(result.text).toBe(BASE);
    expect(input).toEqual(snapshot);
    const chained = applyEdits(input, [op, op]);
    expect(chained.song).toBe(input);
    expect(chained.changed).toBe(false);
  });

  it("a null or non-object op is invalid, not a throw", () => {
    const input = song(BASE);
    for (const bad of [null, undefined, 7, "setLyric"]) {
      const result = applyEdit(input, bad as unknown as EditOp);
      expect(result.song).toBe(input);
      expect(result.changed).toBe(false);
    }
  });
});

describe("valid ops that change nothing", () => {
  it.each<[string, EditOp]>([
    [
      "setLyric with empty text on a chords line",
      { type: "setLyric", line: 4, text: "" },
    ],
    [
      "setLyric with only line breaks on a chords line",
      { type: "setLyric", line: 4, text: "\r\n" },
    ],
    [
      "setLyric with empty text past the last line",
      { type: "setLyric", line: 14, text: "" },
    ],
    [
      "setLyric with empty text on an empty line",
      { type: "setLyric", line: 2, text: "" },
    ],
    [
      "setLyric with the same text",
      { type: "setLyric", line: 3, text: "abc def" },
    ],
    ["transpose 0", { type: "transpose", semitones: 0 }],
    ["transpose 12", { type: "transpose", semitones: 12 }],
    [
      "setMeta clearing an absent name",
      { type: "setMeta", name: "tempo", value: " " },
    ],
    [
      "moveChord to its own index",
      { type: "moveChord", line: 3, anchor: 1, index: 4 },
    ],
  ])("%s", (_name, op) => {
    const input = song(BASE);
    const result = applyEdit(input, op);
    expect(result.changed).toBe(false);
    expect(result.text).toBe(BASE);
    expect(result.song).toEqual(input);
  });
});

describe("applyEdit result", () => {
  it("returns a fresh parse: title, key and capo follow the edited text", () => {
    const input = song("{title: A}\nla\n");
    const result = applyEdits(input, [
      { type: "setMeta", name: "title", value: "B" },
      { type: "setMeta", name: "key", value: "Em" },
      { type: "setMeta", name: "capo", value: "3" },
    ]);
    expect(result.text).toBe("{title: B}\n{key: Em}\n{capo: 3}\nla\n");
    expect(result.song.title).toBe("B");
    expect(result.song.key).toBe("Em");
    expect(result.song.capo).toBe(3);
    expect(result.song).toEqual(parseSong(result.text).song);
    expect(input.title).toBe("A");
  });

  it("line kinds are those of a fresh parse (a chord on an empty line is a chords line)", () => {
    const result = applyEdit(song("a\n\nb\n"), {
      type: "addChord",
      line: 1,
      index: 0,
      chord: "Am",
    });
    expect(result.text).toBe("a\n[Am]\nb\n");
    expect(result.song.lines[1]).toEqual({ kind: "chords", chords: ["Am"] });
    expect(result.changed).toBe(true);
  });

  it("changed compares against the serialized input, so a first edit canonicalizes", () => {
    const input = song("{t: A}\r\n[Am][G]\r\n");
    const result = applyEdit(input, { type: "insertLine", at: 2 });
    expect(result.text).toBe("{title: A}\n[Am] [G]\n\n");
    expect(result.changed).toBe(true);
  });

  it("works on a song with no lines", () => {
    const empty: SongModel = { lines: [] };
    expect(applyEdit(empty, { type: "insertLine", at: 0 }).text).toBe("\n");
    expect(
      applyEdit(empty, { type: "setLyric", line: 0, text: "hi" }).text,
    ).toBe("hi\n");
    const none = applyEdit(empty, { type: "setLyric", line: 0, text: "" });
    expect(none.text).toBe("");
    expect(none.changed).toBe(false);
    expect(applyEdit(empty, { type: "removeLine", line: 0 }).song).toBe(empty);
  });
});

describe("applyEdits", () => {
  it("returns the input itself for no ops", () => {
    const input = song(BASE);
    const result = applyEdits(input, []);
    expect(result.song).toBe(input);
    expect(result.text).toBe(BASE);
    expect(result.changed).toBe(false);
  });

  it("applyEdits with a non-array op list returns the input song", () => {
    const input = song(BASE);
    const snapshot = structuredClone(input);
    const none = applyEdits(input, []);
    for (const bad of [
      null,
      undefined,
      7,
      "setLyric",
      { type: "insertLine" },
    ]) {
      const ops = bad as unknown as EditOp[];
      expect(() => applyEdits(input, ops), String(bad)).not.toThrow();
      const result = applyEdits(input, ops);
      expect(result).toEqual(none);
      expect(result.song).toBe(input);
      expect(result.text).toBe(BASE);
      expect(result.changed).toBe(false);
    }
    expect(input).toEqual(snapshot);
  });

  it("applies ops in order, each on the previous result", () => {
    // The second op addresses the line the first one created.
    expect(
      edit(
        "a\n",
        { type: "insertLine", at: 1 },
        { type: "setLyric", line: 1, text: "b" },
        { type: "addChord", line: 1, index: 1, chord: "G" },
      ),
    ).toBe("a\nb[G]\n");
  });

  it("reports changed against the input, not the last step", () => {
    const input = song("a\nb\n");
    const back = applyEdits(input, [
      { type: "insertLine", at: 1 },
      { type: "removeLine", line: 1 },
    ]);
    expect(back.text).toBe("a\nb\n");
    expect(back.changed).toBe(false);
    const kept = applyEdits(input, [
      { type: "insertLine", at: 1 },
      { type: "transpose", semitones: 0 },
    ]);
    expect(kept.text).toBe("a\n\nb\n");
    expect(kept.changed).toBe(true);
  });

  it("skips an invalid op and keeps going", () => {
    expect(
      edit(
        "a\n",
        { type: "setChord", line: 0, anchor: 0, chord: "G" },
        { type: "addChord", line: 0, index: 0, chord: "G" },
      ),
    ).toBe("[G]a\n");
  });
});

describe("isValidChordText", () => {
  it.each(["Am", " Am ", "F#m7(b5)", "N.C.", "A m", "constructor", "{x}"])(
    "accepts %j",
    (chord) => {
      expect(isValidChordText(chord)).toBe(true);
    },
  );
  it.each(["", " ", "\t\n", "A[", "]", "[Am]", "A\nm", "A\rm"])(
    "rejects %j",
    (chord) => {
      expect(isValidChordText(chord)).toBe(false);
    },
  );
  it("rejects a non-string without throwing", () => {
    expect(isValidChordText(undefined as unknown as string)).toBe(false);
  });
});

describe("setLyric", () => {
  it("removes line breaks from the text", () => {
    expect(edit("a\n", { type: "setLyric", line: 0, text: "x\ny\r\nz" })).toBe(
      "xyz\n",
    );
  });

  it("turns an empty line into a lyric and a cleared lyric into an empty line", () => {
    const typed = applyEdit(song("\n"), {
      type: "setLyric",
      line: 0,
      text: "hello",
    });
    expect(typed.song.lines).toEqual([
      { kind: "lyric", lyric: "hello", chords: [] },
    ]);
    const cleared = applyEdit(typed.song, {
      type: "setLyric",
      line: 0,
      text: "",
    });
    expect(cleared.text).toBe("\n");
    expect(cleared.song.lines).toEqual([{ kind: "empty" }]);
  });

  it("whitespace-only lyric on an empty line changes nothing", () => {
    const input = song(BASE);
    // Precondition: line 2 is an empty line and 14 is the line count.
    expect(input.lines[2]).toEqual({ kind: "empty" });
    expect(input.lines).toHaveLength(14);
    for (const line of [2, 14]) {
      for (const text of [" ", "   ", "\t", " \r\n ", "\n \t\r"]) {
        const result = applyEdit(input, { type: "setLyric", line, text });
        const where = `line ${String(line)} text ${JSON.stringify(text)}`;
        expect(result.changed, where).toBe(false);
        expect(result.text, where).toBe(BASE);
        expect(result.song.lines, where).toHaveLength(14);
        expect(result.song, where).toEqual(input);
      }
    }
    // Text with a visible character still writes the line, spaces included.
    expect(
      applyEdit(input, { type: "setLyric", line: 2, text: " x " }).song
        .lines[2],
    ).toEqual({ kind: "lyric", lyric: " x ", chords: [] });
  });

  it("appends a line when line equals the line count", () => {
    const result = applyEdit(song("a\n"), {
      type: "setLyric",
      line: 1,
      text: "b",
    });
    expect(result.text).toBe("a\nb\n");
    expect(result.song.lines).toHaveLength(2);
  });

  it("clearing a lyric that has chords leaves the chords (a chords line after reparse)", () => {
    const result = applyEdit(song("[Am]abc[G]\n"), {
      type: "setLyric",
      line: 0,
      text: "",
    });
    // `text` is the serialized edited line (a lyric with no text); the song
    // is that text reparsed, where a line of chords only is a chords line.
    expect(result.text).toBe("[Am][G]\n");
    expect(result.song.lines[0]).toEqual({
      kind: "chords",
      chords: ["Am", "G"],
    });
    expect(result.song).toEqual(parseSong(result.text).song);
    expect(result.changed).toBe(true);
  });

  it("gives a chords line lyrics, with every chord at index 0 in order", () => {
    const result = applyEdit(song("[Am] [G] [F]\n"), {
      type: "setLyric",
      line: 0,
      text: "words",
    });
    expect(result.text).toBe("[Am][G][F]words\n");
    expect(lyricAt(result.song, 0).chords).toEqual([
      { index: 0, chord: "Am" },
      { index: 0, chord: "G" },
      { index: 0, chord: "F" },
    ]);
  });

  it("replacing the middle moves inner anchors to the prefix end and shifts the tail", () => {
    // old: a b c d e f (6); new: a b X f (4); p = 2, s = 1.
    // anchors: 0, 2 keep; 3, 4 -> 2 (order kept); 5 -> 3; 6 -> 4.
    expect(
      edit("[A]ab[B]c[C]d[D]e[E]f[F]\n", {
        type: "setLyric",
        line: 0,
        text: "abXf",
      }),
    ).toBe("[A]ab[B][C][D]X[E]f[F]\n");
  });

  it("a boundary anchor exactly at the prefix end stays; exactly at the suffix start shifts", () => {
    // old: abcd, new: abXXcd -> p = 2, s = 2, oldCount - s = 2.
    // index 2 satisfies both rules; the prefix rule wins, so it stays at 2.
    expect(
      edit("ab[P]c[S]d\n", { type: "setLyric", line: 0, text: "abXXcd" }),
    ).toBe("ab[P]XXc[S]d\n");
    // old: abcd, new: ad -> p = 1, s = 1, oldCount - s = 3: index 3 -> 1, index 2 -> p.
    expect(
      edit("a[P]b[M]c[S]d\n", { type: "setLyric", line: 0, text: "ad" }),
    ).toBe("a[P][M][S]d\n");
  });

  it("the common suffix is taken from the remainder after the prefix (repeated letters)", () => {
    // old: aaa (3), new: aa (2): p = 2, s = 0 (p + s <= 2). Anchor 3 -> 2.
    expect(
      edit("[A]a[B]a[C]a[D]\n", { type: "setLyric", line: 0, text: "aa" }),
    ).toBe("[A]a[B]a[C][D]\n");
  });
});

describe("setLyric re-anchoring on a Hebrew line with niqqud", () => {
  // he_niqqud line 4 has 18 grapheme clusters; the fixture anchors are at 0
  // and 9, and anchors at 5, 7 and 18 (end of line) are added for the test.
  const base = applyEdits(song(readFixture("he_niqqud")), [
    { type: "addChord", line: 4, index: 5, chord: "C" },
    { type: "addChord", line: 4, index: 7, chord: "D" },
    { type: "addChord", line: 4, index: 18, chord: "E" },
  ]).song;
  const lyric = lyricAt(base, 4).lyric;
  const g = splitGraphemes(lyric);
  const retype = (text: string): number[] =>
    lyricAt(
      applyEdit(base, { type: "setLyric", line: 4, text }).song,
      4,
    ).chords.map((a) => a.index);

  it("precondition: clusters, not code units", () => {
    expect(g).toHaveLength(18);
    expect(lyric.length).toBeGreaterThan(18);
    // The first cluster is a letter with two marks, the inserted letter differs.
    expect(g[0]?.length).toBe(3);
    expect(g[0]).not.toBe("ו");
    expect(lyricAt(base, 4).chords.map((a) => a.index)).toEqual([
      0, 5, 7, 9, 18,
    ]);
  });

  it("inserting one grapheme at index 0 shifts every anchor >= 1 by exactly 1 and keeps the anchor at 0", () => {
    expect(retype("ו" + lyric)).toEqual([0, 6, 8, 10, 19]);
  });

  it("inserting a pointed grapheme (3 code units) at index 0 still shifts by 1", () => {
    const pointed = g[9] ?? "";
    expect(pointed.length).toBe(3);
    expect(retype(pointed + lyric)).toEqual([0, 6, 8, 10, 19]);
  });

  it("inserting in the middle keeps anchors up to the insertion point and shifts the rest", () => {
    const text = g.slice(0, 7).join("") + "א" + g.slice(7).join("");
    expect(retype(text)).toEqual([0, 5, 7, 10, 19]);
  });

  it("inserting at the end keeps every anchor", () => {
    expect(retype(lyric + "א")).toEqual([0, 5, 7, 9, 18]);
  });

  it("deleting the first cluster (3 code units) shifts later anchors by 1", () => {
    expect(retype(g.slice(1).join(""))).toEqual([0, 4, 6, 8, 17]);
  });

  it("deleting a word in the middle collapses its anchors onto the cut", () => {
    // clusters 5..7 removed: p = 5, s = 10; anchor 7 -> 5, 9 -> 6, 18 -> 15.
    const text = g.slice(0, 5).join("") + g.slice(8).join("");
    expect(retype(text)).toEqual([0, 5, 5, 6, 15]);
  });

  it("deleting at the end pulls the end-of-line anchor back", () => {
    expect(retype(g.slice(0, 16).join(""))).toEqual([0, 5, 7, 9, 16]);
  });
});

describe("chord ops", () => {
  it("addChord inserts after existing anchors at the same index", () => {
    expect(
      edit("[A]ab\n", { type: "addChord", line: 0, index: 0, chord: "B" }),
    ).toBe("[A][B]ab\n");
  });

  it("addChord clamps a negative index to 0 (and so goes after the anchor at 0)", () => {
    expect(
      edit("[A]ab\n", { type: "addChord", line: 0, index: -3, chord: "B" }),
    ).toBe("[A][B]ab\n");
  });

  it("addChord clamps past the end, truncates fractions and trims the chord", () => {
    expect(
      edit("ab[A]\n", { type: "addChord", line: 0, index: 99, chord: " B " }),
    ).toBe("ab[A][B]\n");
    expect(
      edit("ab\n", { type: "addChord", line: 0, index: Infinity, chord: "B" }),
    ).toBe("ab[B]\n");
    expect(
      edit("abc\n", { type: "addChord", line: 0, index: 1.9, chord: "B" }),
    ).toBe("a[B]bc\n");
    expect(
      edit("abc\n", { type: "addChord", line: 0, index: -0.5, chord: "B" }),
    ).toBe("[B]abc\n");
  });

  it("addChord at line === line count appends a line", () => {
    const result = applyEdit(song("a\n"), {
      type: "addChord",
      line: 1,
      index: 5,
      chord: "Am",
    });
    expect(result.text).toBe("a\n[Am]\n");
    expect(result.song.lines).toHaveLength(2);
  });

  it("setChord replaces only that anchor's text, trimmed", () => {
    expect(
      edit("[A]a[B]b\n", {
        type: "setChord",
        line: 0,
        anchor: 1,
        chord: " C ",
      }),
    ).toBe("[A]a[C]b\n");
  });

  it("removeChord removes the anchor; the last anchor index is valid", () => {
    expect(
      edit("[A]a[B]b\n", { type: "removeChord", line: 0, anchor: 1 }),
    ).toBe("[A]ab\n");
    expect(
      edit("[A]a[B]b\n", { type: "removeChord", line: 0, anchor: 0 }),
    ).toBe("a[B]b\n");
  });

  it("removeChord on a lyric with no text and one chord leaves an empty line", () => {
    const model: SongModel = {
      lines: [{ kind: "lyric", lyric: "", chords: [{ index: 0, chord: "A" }] }],
    };
    const result = applyEdit(model, {
      type: "removeChord",
      line: 0,
      anchor: 0,
    });
    expect(result.text).toBe("\n");
    expect(result.song.lines).toEqual([{ kind: "empty" }]);
  });

  it("moveChord re-inserts after the other anchors at the target index", () => {
    expect(
      edit("[A]ab[B]c[C]\n", {
        type: "moveChord",
        line: 0,
        anchor: 0,
        index: 2,
      }),
    ).toBe("ab[B][A]c[C]\n");
    expect(
      edit("[A]ab[B]c[C]\n", {
        type: "moveChord",
        line: 0,
        anchor: 2,
        index: 0,
      }),
    ).toBe("[A][C]ab[B]c\n");
  });

  it("moveChord clamps its index", () => {
    expect(
      edit("[A]ab[B]\n", { type: "moveChord", line: 0, anchor: 0, index: 99 }),
    ).toBe("ab[B][A]\n");
    expect(
      edit("[A]ab[B]\n", { type: "moveChord", line: 0, anchor: 1, index: -7 }),
    ).toBe("[A][B]ab\n");
    expect(
      edit("[A]abc\n", { type: "moveChord", line: 0, anchor: 0, index: 2.7 }),
    ).toBe("ab[A]c\n");
  });
});

describe("line ops", () => {
  it("insertLine clamps an integer position", () => {
    expect(edit("a\nb\n", { type: "insertLine", at: 1 })).toBe("a\n\nb\n");
    expect(edit("a\nb\n", { type: "insertLine", at: -5 })).toBe("\na\nb\n");
    expect(edit("a\nb\n", { type: "insertLine", at: 2 })).toBe("a\nb\n\n");
    expect(edit("a\nb\n", { type: "insertLine", at: 999 })).toBe("a\nb\n\n");
  });

  it("removeLine removes any non-section line", () => {
    expect(edit("a\nb\nc\n", { type: "removeLine", line: 1 })).toBe("a\nc\n");
    expect(edit("{title: T}\na\n", { type: "removeLine", line: 0 })).toBe(
      "a\n",
    );
    expect(edit("a\n", { type: "removeLine", line: 0 })).toBe("");
  });

  it("splitLine sends an anchor exactly at the split index to the second line", () => {
    expect(
      edit("[A]ab[B]cd[C]\n", { type: "splitLine", line: 0, index: 2 }),
    ).toBe("[A]ab\n[B]cd[C]\n");
  });

  it("splitLine at 0 or at the end leaves an empty half", () => {
    const head = applyEdit(song("ab[A]\n"), {
      type: "splitLine",
      line: 0,
      index: 0,
    });
    expect(head.text).toBe("\nab[A]\n");
    expect(head.song.lines[0]).toEqual({ kind: "empty" });
    const tail = applyEdit(song("[A]ab\n"), {
      type: "splitLine",
      line: 0,
      index: 99,
    });
    expect(tail.text).toBe("[A]ab\n\n");
    expect(tail.song.lines[1]).toEqual({ kind: "empty" });
    // An end-of-line anchor is not < index, so it goes to the second half.
    expect(edit("ab[A]\n", { type: "splitLine", line: 0, index: 2 })).toBe(
      "ab\n[A]\n",
    );
    expect(edit("ab\n", { type: "splitLine", line: 0, index: -4 })).toBe(
      "\nab\n",
    );
  });

  it("joinLines concatenates and shifts the second line's anchors by graphemes", () => {
    expect(edit("[A]ab\n[B]c[C]d\n", { type: "joinLines", line: 0 })).toBe(
      "[A]ab[B]c[C]d\n",
    );
    // The first line has two clusters (three code units each).
    const first = "שָׁלֹּ";
    expect(splitGraphemes(first)).toHaveLength(2);
    const joined = applyEdit(song(`${first}\n[G]ab\n`), {
      type: "joinLines",
      line: 0,
    });
    expect(lyricAt(joined.song, 0).chords).toEqual([{ index: 2, chord: "G" }]);
  });

  it("joinLines accepts empty lines on either side", () => {
    expect(edit("\n[A]ab\n", { type: "joinLines", line: 0 })).toBe("[A]ab\n");
    expect(edit("[A]ab\n\nc\n", { type: "joinLines", line: 0 })).toBe(
      "[A]ab\nc\n",
    );
    const both = applyEdit(song("\n\nc\n"), { type: "joinLines", line: 0 });
    expect(both.text).toBe("\nc\n");
    expect(both.song.lines[0]).toEqual({ kind: "empty" });
  });

  it("setChordsLine trims entries, drops empty ones and empties the line when none remain", () => {
    expect(
      edit("[Am] [G]\n", {
        type: "setChordsLine",
        line: 0,
        chords: [" C ", "", "  ", "D/F#"],
      }),
    ).toBe("[C] [D/F#]\n");
    const cleared = applyEdit(song("[Am] [G]\n"), {
      type: "setChordsLine",
      line: 0,
      chords: ["", " "],
    });
    expect(cleared.text).toBe("\n");
    expect(cleared.song.lines).toEqual([{ kind: "empty" }]);
  });

  it("setComment cleans the text and keeps the style", () => {
    const result = applyEdit(song("{comment_box: old}\n"), {
      type: "setComment",
      line: 0,
      text: "  {new}\r\n text} ",
    });
    expect(result.text).toBe("{comment_box: new text}\n");
    expect(result.song.lines[0]).toEqual({
      kind: "comment",
      style: "box",
      text: "new text",
    });
    expect(
      edit("{comment: old}\n", { type: "setComment", line: 0, text: " " }),
    ).toBe("{comment}\n");
  });
});

describe("setMeta", () => {
  it("replaces the first line of that name and leaves later ones alone", () => {
    expect(
      edit("{title: A}\nla\n{title: B}\n", {
        type: "setMeta",
        name: "title",
        value: " {C}\n ",
      }),
    ).toBe("{title: C}\nla\n{title: B}\n");
  });

  it("an empty value removes every line of that name", () => {
    expect(
      edit("{title: A}\n{tempo: 90}\nla\n{title: B}\n", {
        type: "setMeta",
        name: "title",
        value: " {} ",
      }),
    ).toBe("{tempo: 90}\nla\n");
  });

  it("inserts after the leading run of meta lines", () => {
    expect(
      edit("{title: A}\n{meta: direction rtl}\n\nla\n{tempo: 90}\n", {
        type: "setMeta",
        name: "artist",
        value: "X",
      }),
    ).toBe(
      "{title: A}\n{meta: direction rtl}\n{artist: X}\n\nla\n{tempo: 90}\n",
    );
  });

  it("inserts at index 0 when the first line is not meta", () => {
    expect(
      edit("# note\n{title: A}\n", {
        type: "setMeta",
        name: "key",
        value: "G",
      }),
    ).toBe("{key: G}\n# note\n{title: A}\n");
    expect(
      applyEdit({ lines: [] }, { type: "setMeta", name: "key", value: "G" })
        .text,
    ).toBe("{key: G}\n");
  });

  it("accepts each of the five form names", () => {
    expect(
      edit(
        "la\n",
        { type: "setMeta", name: "title", value: "T" },
        { type: "setMeta", name: "artist", value: "A" },
        { type: "setMeta", name: "key", value: "G" },
        { type: "setMeta", name: "capo", value: "2" },
        { type: "setMeta", name: "tempo", value: "90" },
      ),
    ).toBe("{title: T}\n{artist: A}\n{key: G}\n{capo: 2}\n{tempo: 90}\nla\n");
  });
});

const SECTIONS = [
  "intro", // 0
  "{start_of_verse: V1}", // 1
  "a", // 2
  "{end_of_verse}", // 3
  "between", // 4
  "{start_of_chorus}", // 5
  "b", // 6
  "{end_of_chorus}", // 7
  "{start_of_tab}", // 8
  "e|-|", // 9
  "{end_of_tab}", // 10
  "outro", // 11
  "",
].join("\n");

describe("listSections", () => {
  it("lists well-formed sections in order, with label and literal flag", () => {
    expect(listSections(song(SECTIONS))).toEqual([
      { start: 1, end: 3, section: "verse", label: "V1", literal: false },
      { start: 5, end: 7, section: "chorus", literal: false },
      { start: 8, end: 10, section: "tab", literal: true },
    ]);
  });

  it("gives no span for unclosed, unopened and mismatched tags", () => {
    expect(listSections(song("{start_of_verse}\na\n"))).toEqual([]);
    expect(listSections(song("a\n{end_of_verse}\n"))).toEqual([]);
    expect(
      listSections(song("{start_of_verse}\na\n{end_of_chorus}\n")),
    ).toEqual([]);
    // A mismatched end closes nothing and leaves nothing open.
    expect(
      listSections(song("{start_of_verse}\n{end_of_chorus}\n{end_of_verse}\n")),
    ).toEqual([]);
  });

  it("a start inside an open section drops the outer one", () => {
    expect(
      listSections(
        song(
          "{start_of_verse}\n{start_of_chorus}\na\n{end_of_chorus}\n{end_of_verse}\n",
        ),
      ),
    ).toEqual([{ start: 1, end: 3, section: "chorus", literal: false }]);
  });

  it("does not treat a prototype-named section as literal", () => {
    expect(
      listSections(song("{start_of_constructor}\n{end_of_constructor}\n")),
    ).toEqual([{ start: 0, end: 1, section: "constructor", literal: false }]);
  });

  it("does not mutate the song", () => {
    const input = song(SECTIONS);
    const snapshot = structuredClone(input);
    listSections(input);
    expect(input).toEqual(snapshot);
  });
});

describe("section ops", () => {
  it("addSection inserts start, empty and end lines; no label by default", () => {
    expect(
      edit("a\nb\n", { type: "addSection", at: 1, section: "chorus" }),
    ).toBe("a\n{start_of_chorus}\n\n{end_of_chorus}\nb\n");
  });

  it("addSection cleans the label and omits an empty one", () => {
    expect(
      edit("a\n", {
        type: "addSection",
        at: 0,
        section: "verse",
        label: " {V\n2} ",
      }),
    ).toBe("{start_of_verse: V2}\n\n{end_of_verse}\na\n");
    expect(
      edit("a\n", {
        type: "addSection",
        at: 0,
        section: "verse",
        label: " {} ",
      }),
    ).toBe("{start_of_verse}\n\n{end_of_verse}\na\n");
    expect(
      edit("a\n", {
        type: "addSection",
        at: 0,
        section: "bridge",
        label: undefined,
      }),
    ).toBe("{start_of_bridge}\n\n{end_of_bridge}\na\n");
  });

  it("addSection clamps and truncates its position", () => {
    const added = "{start_of_verse}\n\n{end_of_verse}\n";
    expect(edit("a\n", { type: "addSection", at: -3, section: "verse" })).toBe(
      `${added}a\n`,
    );
    expect(edit("a\n", { type: "addSection", at: 99, section: "verse" })).toBe(
      `a\n${added}`,
    );
    expect(
      edit("a\nb\n", { type: "addSection", at: 1.9, section: "verse" }),
    ).toBe(`a\n${added}b\n`);
  });

  it("addSection never lands inside an existing section", () => {
    const at = (n: number): number => {
      const result = applyEdit(song(SECTIONS), {
        type: "addSection",
        at: n,
        section: "bridge",
      });
      return result.song.lines.findIndex(
        (l) => l.kind === "section" && l.section === "bridge",
      );
    };
    // verse spans 1..3: at 1 (its start) stays before it; 2 and 3 move to 4.
    expect(at(1)).toBe(1);
    expect(at(2)).toBe(4);
    expect(at(3)).toBe(4);
    expect(at(4)).toBe(4);
    // tab spans 8..10 (literal): inside goes after its end.
    expect(at(9)).toBe(11);
    expect(at(8)).toBe(8);
  });

  it("renameSection renames both tags and sets or removes the label", () => {
    expect(
      edit(SECTIONS, {
        type: "renameSection",
        line: 1,
        section: "bridge",
        label: " B{1} ",
      }),
    ).toBe(
      SECTIONS.replace("{start_of_verse: V1}", "{start_of_bridge: B1}").replace(
        "{end_of_verse}",
        "{end_of_bridge}",
      ),
    );
    // No label given: the old label is removed.
    expect(
      edit(SECTIONS, { type: "renameSection", line: 1, section: "verse" }),
    ).toBe(SECTIONS.replace("{start_of_verse: V1}", "{start_of_verse}"));
  });

  it("moveSection exchanges two sections and keeps the lines between them", () => {
    const moved = [
      "intro",
      "{start_of_chorus}",
      "b",
      "{end_of_chorus}",
      "between",
      "{start_of_verse: V1}",
      "a",
      "{end_of_verse}",
      "{start_of_tab}",
      "e|-|",
      "{end_of_tab}",
      "outro",
      "",
    ].join("\n");
    expect(
      edit(SECTIONS, { type: "moveSection", line: 1, direction: "down" }),
    ).toBe(moved);
    expect(
      edit(SECTIONS, { type: "moveSection", line: 5, direction: "up" }),
    ).toBe(moved);
  });

  it("moveSection moves a literal section", () => {
    const result = applyEdit(song(SECTIONS), {
      type: "moveSection",
      line: 8,
      direction: "up",
    });
    expect(listSections(result.song).map((s) => s.section)).toEqual([
      "verse",
      "tab",
      "chorus",
    ]);
    expect(result.song.lines[6]).toEqual({ kind: "tab", text: "e|-|" });
  });

  it("removeSection removes the start, body and end lines", () => {
    expect(edit(SECTIONS, { type: "removeSection", line: 5 })).toBe(
      SECTIONS.replace("{start_of_chorus}\nb\n{end_of_chorus}\n", ""),
    );
    expect(edit(SECTIONS, { type: "removeSection", line: 8 })).toBe(
      SECTIONS.replace("{start_of_tab}\ne|-|\n{end_of_tab}\n", ""),
    );
  });
});

describe("transpose", () => {
  it("transposes chords and the key through transposeSong", () => {
    const result = applyEdit(song("{key: E}\n[E]la [A]la\n[B] [C#m]\n"), {
      type: "transpose",
      semitones: 1,
    });
    expect(result.text).toBe("{key: F}\n[F]la [Bb]la\n[C] [Dm]\n");
    expect(result.song.key).toBe("F");
  });

  it("accepts negative and large integers", () => {
    expect(edit("[C]a\n", { type: "transpose", semitones: -1 })).toBe("[B]a\n");
    expect(edit("[C]a\n", { type: "transpose", semitones: 26 })).toBe("[D]a\n");
  });
});

describe("songChords", () => {
  it("lists distinct chords in first-appearance order over lyric and chords lines", () => {
    expect(
      songChords(song("[G]a[Am]b\n[C] [G] [D]\n{comment: [X]}\n[Am]c[Em]\n")),
    ).toEqual(["G", "Am", "C", "D", "Em"]);
    expect(songChords({ lines: [] })).toEqual([]);
  });

  it("handles prototype-named chords", () => {
    expect(
      songChords(song("[constructor]a[__proto__]b[toString]c[constructor]\n")),
    ).toEqual(["constructor", "__proto__", "toString"]);
  });
});

describe("suggestChords", () => {
  const keyed = (key: string): SongModel => song(`{key: ${key}}\nla\n`);

  it.each([
    ["G", "", ["G", "Am", "Bm", "C", "D", "Em"]],
    ["Em", "", ["Em", "G", "Am", "Bm", "C", "D"]],
    ["E", "", ["E", "F#m", "G#m", "A", "B", "C#m"]],
    ["A", "", ["A", "Bm", "C#m", "D", "E", "F#m"]],
    ["Bb", "", ["Bb", "Cm", "Dm", "Eb", "F", "Gm"]],
    ["F#m", "", ["F#m", "A", "Bm", "C#m", "D", "E"]],
    ["G", "a", ["Am"]],
  ])("key %s, prefix %j", (key, prefix, expected) => {
    expect(suggestChords(keyed(key), prefix)).toEqual(expected);
  });

  it("flat keys suggest no sharp chords", () => {
    expect(suggestChords(keyed("Gb"), "")).toEqual([
      "Gb",
      "Abm",
      "Bbm",
      "Cb",
      "Db",
      "Ebm",
    ]);
    expect(suggestChords(keyed("Ebm"), "")).toEqual([
      "Ebm",
      "Gb",
      "Abm",
      "Bbm",
      "Cb",
      "Db",
    ]);
    for (const key of ["Gb", "Db", "Cb", "Ab", "Eb", "Bb", "Ebm", "Abm"]) {
      const chords = suggestChords(keyed(key), "");
      expect(chords, key).toHaveLength(6);
      expect(chords[0], key).toBe(key);
      expect(
        chords.filter((chord) => chord.includes("#")),
        key,
      ).toEqual([]);
    }
  });

  it("sharp keys suggest no flat chords", () => {
    expect(suggestChords(keyed("C#"), "")).toEqual([
      "C#",
      "D#m",
      "E#m",
      "F#",
      "G#",
      "A#m",
    ]);
    expect(suggestChords(keyed("A#m"), "")).toEqual([
      "A#m",
      "C#",
      "D#m",
      "E#m",
      "F#",
      "G#",
    ]);
    for (const key of ["C#", "F#", "A#m", "C#m", "F#m", "G#m", "D#m"]) {
      const chords = suggestChords(keyed(key), "");
      expect(chords, key).toHaveLength(6);
      expect(chords[0], key).toBe(key);
      expect(
        chords.filter((chord) => /^[A-G]b/.test(chord)),
        key,
      ).toEqual([]);
    }
  });

  it.each([
    ["Cb", ["Cb", "Dbm", "Ebm", "Fb", "Gb", "Abm"]],
    ["Abm", ["Abm", "Cb", "Dbm", "Ebm", "Fb", "Gb"]],
    ["G#", ["G#", "A#m", "B#m", "C#", "D#", "E#m"]],
    ["E#m", ["E#m", "G#", "A#m", "B#m", "C#", "D#"]],
    ["F#", ["F#", "G#m", "A#m", "B", "C#", "D#m"]],
    ["Db", ["Db", "Ebm", "Fm", "Gb", "Ab", "Bbm"]],
    ["D#m", ["D#m", "F#", "G#m", "A#m", "B", "C#"]],
    ["G#m", ["G#m", "B", "C#m", "D#m", "E", "F#"]],
    ["C", ["C", "Dm", "Em", "F", "G", "Am"]],
    ["Am", ["Am", "C", "Dm", "Em", "F", "G"]],
  ])("letter-spells key %s", (key, expected) => {
    expect(suggestChords(keyed(key), "")).toEqual(expected);
  });

  it.each([
    ["Fb", ["Fb", "Gbm", "Abm", "A", "B", "Dbm"]],
    ["D#", ["D#", "Fm", "Gm", "G#", "A#", "Cm"]],
    ["A#", ["A#", "Cm", "Dm", "D#", "F", "Gm"]],
    ["Gbm", ["Gbm", "A", "Bm", "Dbm", "D", "E"]],
  ])(
    "keys needing a double accidental keep the table spelling: %s",
    (key, expected) => {
      expect(suggestChords(keyed(key), "")).toEqual(expected);
    },
  );

  it("every suggestion of every flat and sharp key parses as a chord", () => {
    const keys = [
      "Gb",
      "Db",
      "Cb",
      "Ab",
      "Eb",
      "Bb",
      "Ebm",
      "Abm",
      "C#",
      "F#",
      "A#m",
      "C#m",
      "F#m",
      "G#m",
      "D#m",
      "G#",
      "E#m",
      "Fb",
      "D#",
      "A#",
      "Gbm",
    ];
    for (const key of keys) {
      for (const chord of suggestChords(keyed(key), "")) {
        expect(parseChord(chord), `${key}: ${chord}`).not.toBeNull();
      }
    }
  });

  it("puts the song's chords first and does not repeat them", () => {
    expect(suggestChords(song("{key: G}\n[D7]a[Em]b[G]\n"), "")).toEqual([
      "D7",
      "Em",
      "G",
      "Am",
      "Bm",
      "C",
      "D",
    ]);
  });

  it("matches the trimmed prefix without regard to ASCII case", () => {
    const model = song("{key: G}\n[D7]a[em7]b\n");
    expect(suggestChords(model, " d ")).toEqual(["D7", "D"]);
    expect(suggestChords(model, "E")).toEqual(["em7", "Em"]);
    expect(suggestChords(model, "EM7")).toEqual(["em7"]);
    expect(suggestChords(model, "x")).toEqual([]);
  });

  it("limits the result; a bad limit means 12", () => {
    const many = song(
      "[A1]a[A2]a[A3]a[A4]a[A5]a[A6]a[A7]a[A8]a[A9]a[A10]a[A11]a[A12]a[A13]a[A14]a\n",
    );
    expect(suggestChords(many, "")).toHaveLength(12);
    expect(suggestChords(many, "", 14)).toHaveLength(14);
    expect(suggestChords(many, "", 3)).toEqual(["A1", "A2", "A3"]);
    expect(suggestChords(many, "", 1)).toEqual(["A1"]);
    for (const bad of [0, -1, 2.5, NaN, Infinity]) {
      expect(suggestChords(many, "", bad)).toHaveLength(12);
    }
  });

  it("offers only the used chords when the key is absent or not a key", () => {
    expect(suggestChords(song("[Am]a\n"), "")).toEqual(["Am"]);
    expect(suggestChords(song("{key: H}\n[Am]a\n"), "")).toEqual(["Am"]);
    expect(suggestChords(song("{key: constructor}\nla\n"), "")).toEqual([]);
    expect(suggestChords(song("la\n"), "")).toEqual([]);
  });

  it("does not mutate the song", () => {
    const input = song("{key: G}\n[D7]a\n");
    const snapshot = structuredClone(input);
    suggestChords(input, "d");
    songChords(input);
    expect(input).toEqual(snapshot);
  });
});

describe("prototype-named user text", () => {
  const NAMES = ["constructor", "__proto__", "toString"];
  const text = "{title: T}\n{start_of_verse}\n[Am]abc\n{end_of_verse}\n";

  it.each(NAMES)(
    "%s as a setMeta name is rejected and the song is intact",
    (name) => {
      const input = song(text);
      const result = applyEdit(
        input,
        loose({ type: "setMeta", name, value: "x" }),
      );
      expect(result.song).toBe(input);
      expect(result.text).toBe(text);
      const cleared = applyEdit(
        input,
        loose({ type: "setMeta", name, value: "" }),
      );
      expect(cleared.song).toBe(input);
      expect(cleared.text).toBe(text);
    },
  );

  it.each(NAMES)(
    "%s as a section name is rejected and the song is intact",
    (name) => {
      const input = song(text);
      for (const op of [
        loose({ type: "addSection", at: 0, section: name }),
        loose({ type: "renameSection", line: 1, section: name }),
      ]) {
        const result = applyEdit(input, op);
        expect(result.song).toBe(input);
        expect(result.text).toBe(text);
      }
    },
  );

  it.each(NAMES)(
    "%s as chord text is stored verbatim like any chord",
    (name) => {
      const result = applyEdits(song(text), [
        { type: "addChord", line: 2, index: 1, chord: name },
        { type: "setChord", line: 2, anchor: 0, chord: name },
      ]);
      expect(result.text).toBe(
        `{title: T}\n{start_of_verse}\n[${name}]a[${name}]bc\n{end_of_verse}\n`,
      );
      expect(songChords(result.song)).toEqual([name]);
      expect(suggestChords(result.song, name)).toEqual([name]);
      expect(suggestChords(song(text), name)).toEqual([]);
      expect(result.song).toEqual(parseSong(result.text).song);
    },
  );

  it.each(NAMES)(
    "%s as a chords-line entry, comment and metadata value",
    (name) => {
      expect(
        edit("[Am]\n{comment: c}\n", {
          type: "setChordsLine",
          line: 0,
          chords: [name],
        }),
      ).toBe(`[${name}]\n{comment: c}\n`);
      expect(
        edit(
          "[Am]\n{comment: c}\n",
          { type: "setComment", line: 1, text: name },
          { type: "setMeta", name: "title", value: name },
        ),
      ).toBe(`{title: ${name}}\n[Am]\n{comment: ${name}}\n`);
    },
  );
});
