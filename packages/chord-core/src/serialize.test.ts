import { describe, expect, it } from "vitest";
import {
  ALL_FIXTURE_NAMES,
  readCanonical,
  readFixture,
  readGolden,
} from "test-fixtures";
import type { SongLine, SongModel } from "./model";
import { serializeSong } from "./serialize";
import { parseSong } from "./song";

const ser = (...ls: SongLine[]): string => serializeSong({ lines: ls });
const norm = (src: string): string => serializeSong(parseSong(src).song);

function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === "object") {
    Object.values(v).forEach(deepFreeze);
    Object.freeze(v);
  }
  return v;
}

describe("serializeSong round trip", () => {
  it.each(ALL_FIXTURE_NAMES)("(c) canonical output for %s", (name) => {
    expect(norm(readFixture(name))).toBe(readCanonical(name));
  });
  it.each(ALL_FIXTURE_NAMES)("(d) idempotent for %s", (name) => {
    const canonical = readCanonical(name);
    expect(norm(canonical)).toBe(canonical);
  });
  it.each(ALL_FIXTURE_NAMES)("(e) model stable for %s", (name) => {
    const m = readGolden(name) as SongModel;
    expect(parseSong(serializeSong(m)).song).toStrictEqual(m);
    const parsed = parseSong(readFixture(name)).song;
    expect(parseSong(serializeSong(parsed)).song).toStrictEqual(parsed);
  });
});

describe("serializeSong per kind", () => {
  it("emits each kind canonically", () => {
    const out = ser(
      { kind: "lyric", lyric: "Morning", chords: [{ index: 2, chord: "C" }] },
      { kind: "chords", chords: ["Am", "G"] },
      { kind: "empty" },
      { kind: "meta", name: "title", value: "T" },
      { kind: "meta", name: "subtitle", value: "" },
      { kind: "meta", name: "direction", value: "rtl" },
      { kind: "meta", name: "direction", value: "" },
      { kind: "meta", name: "mood", value: "calm down" },
      { kind: "meta", name: "mood", value: "" },
      { kind: "comment", style: "normal", text: "a" },
      { kind: "comment", style: "italic", text: "b" },
      { kind: "comment", style: "box", text: "" },
      { kind: "section", edge: "start", section: "verse" },
      { kind: "section", edge: "start", section: "chorus", label: "L 1" },
      { kind: "section", edge: "end", section: "chorus" },
      { kind: "tab", text: "e|--0--|" },
      { kind: "remark", text: " hi" },
      { kind: "directive", name: "new_page" },
      { kind: "directive", name: "new_key", value: "G" },
      { kind: "raw", text: "{broken" },
    );
    expect(out).toBe(
      [
        "Mo[C]rning",
        "[Am] [G]",
        "",
        "{title: T}",
        "{subtitle}",
        "{meta: direction rtl}",
        "{meta: direction}",
        "{meta: mood calm down}",
        "{meta: mood}",
        "{comment: a}",
        "{comment_italic: b}",
        "{comment_box}",
        "{start_of_verse}",
        "{start_of_chorus: L 1}",
        "{end_of_chorus}",
        "e|--0--|",
        "# hi",
        "{new_page}",
        "{new_key: G}",
        "{broken",
        "",
      ].join("\n"),
    );
  });
  it("emits equal-index anchors adjacent in array order, and EOL anchors", () => {
    expect(
      ser({
        kind: "lyric",
        lyric: "abc",
        chords: [
          { index: 1, chord: "A" },
          { index: 1, chord: "B" },
          { index: 3, chord: "C" },
          { index: 3, chord: "D" },
        ],
      }),
    ).toBe("a[A][B]bc[C][D]\n");
  });
  it("anchors a niqqud cluster before the whole cluster", () => {
    expect(
      ser({
        kind: "lyric",
        lyric: "שָׁלום",
        chords: [{ index: 1, chord: "Am" }],
      }),
    ).toBe("שָׁ[Am]לום\n");
  });
  it("clamps out-of-range anchors", () => {
    expect(
      ser({
        kind: "lyric",
        lyric: "ab",
        chords: [
          { index: -3, chord: "X" },
          { index: 99, chord: "Y" },
        ],
      }),
    ).toBe("[X]ab[Y]\n");
  });
  it("returns the empty string for no lines", () => {
    expect(serializeSong({ lines: [] })).toBe("");
  });
  it("does not mutate a deep-frozen model", () => {
    const m = deepFreeze(parseSong(readFixture("aliases_input")).song);
    expect(() => serializeSong(m)).not.toThrow();
    expect(serializeSong(m)).toBe(readCanonical("aliases_input"));
  });
  it('saves label="…" as the plain value', () => {
    expect(norm('{sov: label="V 1"}')).toBe("{start_of_verse: V 1}\n");
  });
});

describe("serializeSong normalizations", () => {
  it.each([
    ["CRLF becomes LF", "a\r\nb\r\n", "a\nb\n"],
    ["missing final newline is added", "a", "a\n"],
    [
      "aliases become long names",
      "{t: x}\n{st: y}\n{c: z}\n{ci: z}\n{cb: z}\n{soc}\n{eoc}\n{sov}\n{eov}\n{sob}\n{eob}\n{sot}\n{eot}\n{sog}\n{eog}",
      "{title: x}\n{subtitle: y}\n{comment: z}\n{comment_italic: z}\n{comment_box: z}\n{start_of_chorus}\n{end_of_chorus}\n{start_of_verse}\n{end_of_verse}\n{start_of_bridge}\n{end_of_bridge}\n{start_of_tab}\n{end_of_tab}\n{start_of_grid}\n{end_of_grid}\n",
    ],
    [
      "tag-name case becomes lowercase",
      "{TITLE: X}\n{New_Page}\n",
      "{title: X}\n{new_page}\n",
    ],
    ["whitespace around tag parts", "  {  key :  Am  }  \n", "{key: Am}\n"],
    ["{meta: title x} becomes {title: x}", "{meta: title x}\n", "{title: x}\n"],
    [
      "{direction: v} becomes {meta: direction v}",
      "{direction: rtl}\n",
      "{meta: direction rtl}\n",
    ],
    [
      "label attribute becomes plain label",
      '{start_of_verse: label="B 2"}\n',
      "{start_of_verse: B 2}\n",
    ],
    ["whitespace-only lines become empty", "a\n   \n\t\nb\n", "a\n\n\nb\n"],
    [
      "a value on an end tag is dropped",
      "{sov}\n{eov: x}\n{soc}\n{end_of_chorus: y}\n",
      "{start_of_verse}\n{end_of_verse}\n{start_of_chorus}\n{end_of_chorus}\n",
    ],
    [
      "a chord inside a cluster moves to the next cluster",
      "ש[Am]ָלום\n",
      "שָ[Am]לום\n",
    ],
    [
      "empty values use the no-value form",
      "{comment:}\n{title:}\n{direction:}\n{meta: foo:}\n{x:  }\n{sov:}\n",
      "{comment}\n{title}\n{meta: direction}\n{meta: foo:}\n{x}\n{start_of_verse}\n",
    ],
    [
      "inner meta name is lowercased",
      "{meta: Direction rtl}\n",
      "{meta: direction rtl}\n",
    ],
    ["every \\r before \\n is stripped", "a\r\r\nb\n", "a\nb\n"],
    [
      "chord-only lines are re-joined with one space",
      "[Am][G]\n  [Am]   [G]  [F]  \n",
      "[Am] [G]\n[Am] [G] [F]\n",
    ],
    [
      "an indented end tag closes a tab section",
      "{sot}\nx\n   {end_of_tab}\n",
      "{start_of_tab}\nx\n{end_of_tab}\n",
    ],
  ])("%s", (_name, input, expected) => {
    expect(norm(input)).toBe(expected);
  });

  it("preserves # and {…} inside lyrics byte-exactly", () => {
    const src = "We are [G]number #1 {c: x} [C]yes } ]\n  # indented\n";
    expect(norm(src)).toBe(src);
  });
});
