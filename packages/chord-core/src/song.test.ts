import { describe, expect, it } from "vitest";
import {
  ALL_FIXTURE_NAMES,
  readCanonical,
  readDiagnostics,
  readFixture,
  readGolden,
} from "test-fixtures";
import type { Diagnostic, SongLine, SongModel } from "./model";
import { splitGraphemes } from "./graphemes";
import { serializeSong } from "./serialize";
import { parseSong } from "./song";

const lines = (src: string): SongLine[] => parseSong(src).song.lines;
const diags = (src: string): Diagnostic[] => parseSong(src).diagnostics;

describe("parseSong fixtures", () => {
  it.each(ALL_FIXTURE_NAMES)("(a) matches golden for %s", (name) => {
    expect(parseSong(readFixture(name)).song).toStrictEqual(readGolden(name));
  });

  it.each(ALL_FIXTURE_NAMES)("(b) matches diagnostics for %s", (name) => {
    expect(parseSong(readFixture(name)).diagnostics).toStrictEqual(
      readDiagnostics(name),
    );
  });

  it("golden comparison is non-vacuous", () => {
    const golden = structuredClone(readGolden("he_plain")) as SongModel;
    const line = golden.lines.find(
      (l) => l.kind === "lyric" && l.chords.length > 0,
    );
    if (line?.kind !== "lyric") throw new Error("no lyric line");
    line.chords[0]!.index += 1;
    expect(parseSong(readFixture("he_plain")).song).not.toStrictEqual(golden);
  });

  it("CRLF variant of aliases_input parses to the same model and canonical form", () => {
    const crlf = readFixture("aliases_input").replace(/\n/g, "\r\n");
    const { song } = parseSong(crlf);
    expect(song).toStrictEqual(readGolden("aliases_input"));
    expect(serializeSong(song)).toBe(readCanonical("aliases_input"));
  });
});

describe("parseSong targeted (G1 cases)", () => {
  it("parses CRLF identically to LF", () => {
    const lf = "{title: T}\n{meta: direction rtl}\n[Am]שלום\n\nעולם\n";
    expect(parseSong(lf.replace(/\n/g, "\r\n"))).toStrictEqual(parseSong(lf));
  });
  it("strips every \\r before \\n", () => {
    expect(lines("a\r\r\n")).toStrictEqual([
      { kind: "lyric", lyric: "a", chords: [] },
    ]);
  });
  it("returns no lines for empty input", () => {
    expect(parseSong("")).toStrictEqual({
      song: { lines: [] },
      diagnostics: [],
    });
  });
  it("drops only the line after a final newline", () => {
    expect(lines("a\n")).toHaveLength(1);
    expect(lines("a\n\n")).toStrictEqual([
      { kind: "lyric", lyric: "a", chords: [] },
      { kind: "empty" },
    ]);
    expect(lines("a")).toHaveLength(1);
  });
  it("sets direction only for rtl/ltr", () => {
    const dir = (s: string) => parseSong(s).song.direction;
    expect(
      dir("{meta: direction rtl}\n{meta: direction ltr}\na\n"),
    ).toBeUndefined();
    expect(dir("{meta: direction rtl}\n{meta: direction rtl}\na\n")).toBe(
      "rtl",
    );
    expect(dir("{meta: direction up}\na\n")).toBeUndefined();
    expect(dir("{meta: direction rtl}\n{direction: up}\na\n")).toBeUndefined();
    expect(dir("{direction: RTL}\na\n")).toBe("rtl");
    expect(dir("{meta: direction rtl}\n{direction: ltr}\na\n")).toBeUndefined();
    expect(dir("{direction:}\na\n")).toBeUndefined();
  });
  it("anchors a chord at end of line at graphemeCount", () => {
    expect(lines("abc[G]\n")[0]).toStrictEqual({
      kind: "lyric",
      lyric: "abc",
      chords: [{ index: 3, chord: "G" }],
    });
  });
  it("counts niqqud as one grapheme", () => {
    const line = lines("שָׁ[Am]לום\n")[0];
    if (line?.kind !== "lyric") throw new Error("expected lyric");
    expect(line.chords).toStrictEqual([{ index: 1, chord: "Am" }]);
    expect(splitGraphemes(line.lyric)).toHaveLength(4);
  });
  it("anchors mid-word chords", () => {
    expect(lines("ro[C#]ll\n")[0]).toStrictEqual({
      kind: "lyric",
      lyric: "roll",
      chords: [{ index: 2, chord: "C#" }],
    });
  });
  it("maps chord-only lines", () => {
    expect(lines("[Am] [G] [F]\n")[0]).toStrictEqual({
      kind: "chords",
      chords: ["Am", "G", "F"],
    });
  });
});

describe("parseSong never throws (R2)", () => {
  const inputs = [
    "\r",
    "{",
    "[",
    "]",
    "[[A]",
    "{}",
    "{:}",
    "\ud800",
    "a\udc00[A]\ud800b",
    "[\ud800]",
    "{title: \ud800}",
    "\n\n\n",
    "{start_of_tab}",
    "}{",
  ];
  it.each(inputs.map((s) => [JSON.stringify(s), s] as const))(
    "returns a ParseResult for %s",
    (_label, src) => {
      const r = parseSong(src);
      expect(Array.isArray(r.song.lines)).toBe(true);
      expect(Array.isArray(r.diagnostics)).toBe(true);
    },
  );

  it("handles a 10 000-line input", () => {
    const src = Array.from({ length: 10_000 }, (_, i) =>
      i % 3 === 0 ? "[Am]שלום [G]עולם" : i % 3 === 1 ? "{c: x}" : "",
    ).join("\n");
    expect(parseSong(src).song.lines).toHaveLength(10_000);
  });
});

describe("parseSong diagnostics", () => {
  const d = (
    line: number,
    column: number,
    code: Diagnostic["code"],
    message: string,
  ): Diagnostic => ({ line, column, code, message });

  it("Malformed directive at the first {", () => {
    expect(diags("  {title: x")).toStrictEqual([
      d(1, 3, "syntax", "Malformed directive"),
    ]);
    expect(lines("  {title: x")[0]).toStrictEqual({
      kind: "raw",
      text: "  {title: x",
    });
  });
  it("{title: a} {artist: b} is raw plus Malformed directive", () => {
    expect(lines("{title: a} {artist: b}")[0]).toStrictEqual({
      kind: "raw",
      text: "{title: a} {artist: b}",
    });
    expect(diags("{title: a} {artist: b}")).toStrictEqual([
      d(1, 1, "syntax", "Malformed directive"),
    ]);
  });
  it("{} and {:} are malformed", () => {
    expect(diags("{}\n{:}").map((x) => x.message)).toStrictEqual([
      "Malformed directive",
      "Malformed directive",
    ]);
  });
  it("Unterminated chord at that [", () => {
    expect(diags("ab [A")).toStrictEqual([
      d(1, 4, "syntax", "Unterminated chord"),
    ]);
    expect(lines("ab [A")[0]).toStrictEqual({ kind: "raw", text: "ab [A" });
  });
  it("Empty chord at that [", () => {
    expect(diags("x[]")).toStrictEqual([d(1, 2, "syntax", "Empty chord")]);
  });
  it("[]x [A gives exactly one Empty chord diagnostic", () => {
    expect(diags("[]x [A")).toStrictEqual([d(1, 1, "syntax", "Empty chord")]);
  });
  it("Nested chord bracket at the inner [", () => {
    expect(diags("[A[B")).toStrictEqual([
      d(1, 3, "syntax", "Nested chord bracket"),
    ]);
    expect(diags("[A[B]")).toStrictEqual([
      d(1, 3, "syntax", "Nested chord bracket"),
    ]);
  });
  it("section-unopened", () => {
    expect(diags("a\n  {eoc}")).toStrictEqual([
      d(2, 3, "section-unopened", "end_of_chorus without an open section"),
    ]);
  });
  it("section-mismatch closes the open section", () => {
    expect(diags("{sov}\n{end_of_chorus}\n{eov}")).toStrictEqual([
      d(2, 1, "section-mismatch", "end_of_chorus while verse is open"),
      d(3, 1, "section-unopened", "end_of_verse without an open section"),
    ]);
  });
  it("section-unclosed at EOF, at the start tag", () => {
    expect(diags("a\n  {start_of_bridge}\nb")).toStrictEqual([
      d(2, 3, "section-unclosed", "bridge section is not closed"),
    ]);
  });
  it("a start while a section is open reports unclosed, then opens", () => {
    expect(diags("{sov}\nx\n{soc}\ny\n{eoc}")).toStrictEqual([
      d(1, 1, "section-unclosed", "verse section is not closed"),
    ]);
  });
  it("invalid-capo for {capo: x} and {capo: 99}", () => {
    expect(diags("{capo: x}")).toStrictEqual([
      d(1, 1, "invalid-capo", 'Invalid capo value "x"'),
    ]);
    const r = parseSong("a\n {capo: 99}");
    expect(r.diagnostics).toStrictEqual([
      d(2, 2, "invalid-capo", 'Invalid capo value "99"'),
    ]);
    expect(r.song.capo).toBeUndefined();
    expect("capo" in r.song).toBe(false);
    expect(diags("{capo:}")).toStrictEqual([
      d(1, 1, "invalid-capo", 'Invalid capo value ""'),
    ]);
  });
  it("valid capo sets song.capo", () => {
    expect(parseSong("{capo: 3}").song.capo).toBe(3);
    expect(parseSong("{capo: 24}").song.capo).toBe(24);
    expect(parseSong("{capo: 0}").song.capo).toBe(0);
  });
  it("never reports unknown-chord", () => {
    const r = parseSong("[Zzz]a [H7]b\n[Q]");
    expect(r.diagnostics.some((x) => x.code === "unknown-chord")).toBe(false);
  });
  it("sorts by line then column (unclosed is reported at the earlier start line)", () => {
    const r = parseSong("{sov}\n[]\n{soc}\n{eob}");
    expect(r.diagnostics.map((x) => [x.line, x.column, x.code])).toStrictEqual([
      [1, 1, "section-unclosed"],
      [2, 1, "syntax"],
      [4, 1, "section-mismatch"],
    ]);
    const late = parseSong("x[]\n  {sov}\n  {soc}\n");
    expect(late.diagnostics.map((x) => [x.line, x.column])).toStrictEqual([
      [1, 2],
      [2, 3],
      [3, 3],
    ]);
  });
  it("column is a UTF-16 code-unit offset plus 1", () => {
    expect(diags("😀[A")).toStrictEqual([
      d(1, 3, "syntax", "Unterminated chord"),
    ]);
  });
});

describe("parseSong classification", () => {
  it("mid-line # is lyric text", () => {
    expect(lines("We are [G]number #1 [C]yes")[0]).toStrictEqual({
      kind: "lyric",
      lyric: "We are number #1 yes",
      chords: [
        { index: 7, chord: "G" },
        { index: 17, chord: "C" },
      ],
    });
  });
  it("leading-space # is lyric, first-column # is remark", () => {
    expect(lines("  # x")[0]).toStrictEqual({
      kind: "lyric",
      lyric: "  # x",
      chords: [],
    });
    expect(lines("# x")[0]).toStrictEqual({ kind: "remark", text: " x" });
  });
  it("inline {c: x} inside a lyric line stays lyric text", () => {
    expect(lines("abc {c: x} def")[0]).toStrictEqual({
      kind: "lyric",
      lyric: "abc {c: x} def",
      chords: [],
    });
  });
  it("whitespace-only lines are empty; with [ they are not", () => {
    expect(lines("   \n\t")).toStrictEqual([
      { kind: "empty" },
      { kind: "empty" },
    ]);
    expect(lines("  [Am]  ")[0]).toStrictEqual({
      kind: "chords",
      chords: ["Am"],
    });
  });
  it('label="V 1" is the plain label; other attributes keep the value', () => {
    expect(lines('{start_of_verse: label="V 1"}')[0]).toStrictEqual({
      kind: "section",
      edge: "start",
      section: "verse",
      label: "V 1",
    });
    expect(lines('{sov: id="x"}')[0]).toStrictEqual({
      kind: "section",
      edge: "start",
      section: "verse",
      label: 'id="x"',
    });
  });
  it("a value on an end tag is dropped; empty value means no label", () => {
    expect(lines("{sov}\n{end_of_verse: x}")[1]).toStrictEqual({
      kind: "section",
      edge: "end",
      section: "verse",
    });
    expect(lines("{start_of_verse:  }")[0]).toStrictEqual({
      kind: "section",
      edge: "start",
      section: "verse",
    });
  });
  it("grid and abc are literal sections", () => {
    const src =
      "{sog}\n{title: x}\n# y\n[A]\n{eog}\n{start_of_abc}\nX:1\n{end_of_abc}";
    expect(lines(src)).toStrictEqual([
      { kind: "section", edge: "start", section: "grid" },
      { kind: "tab", text: "{title: x}" },
      { kind: "tab", text: "# y" },
      { kind: "tab", text: "[A]" },
      { kind: "section", edge: "end", section: "grid" },
      { kind: "section", edge: "start", section: "abc" },
      { kind: "tab", text: "X:1" },
      { kind: "section", edge: "end", section: "abc" },
    ]);
    expect(diags(src)).toStrictEqual([]);
  });
  it("an empty tab section has no phantom line", () => {
    expect(lines("{sot}\n{eot}")).toHaveLength(2);
  });
  it("an unclosed literal section keeps its lines as tab", () => {
    const r = parseSong("{start_of_tab}\n{x}\n\nend");
    expect(r.song.lines.slice(1)).toStrictEqual([
      { kind: "tab", text: "{x}" },
      { kind: "tab", text: "" },
      { kind: "tab", text: "end" },
    ]);
    expect(r.diagnostics).toStrictEqual([
      {
        line: 1,
        column: 1,
        code: "section-unclosed",
        message: "tab section is not closed",
      },
    ]);
  });
  it("an indented {end_of_tab} closes a tab section", () => {
    expect(lines("{sot}\nx\n  {end_of_tab}\ny")).toStrictEqual([
      { kind: "section", edge: "start", section: "tab" },
      { kind: "tab", text: "x" },
      { kind: "section", edge: "end", section: "tab" },
      { kind: "lyric", lyric: "y", chords: [] },
    ]);
  });
  it("a non-matching end tag inside a literal section is tab", () => {
    expect(lines("{sot}\n{eov}\n{EOT}")[1]).toStrictEqual({
      kind: "tab",
      text: "{eov}",
    });
    expect(lines("{sot}\n{eov}\n{EOT}")[2]).toStrictEqual({
      kind: "section",
      edge: "end",
      section: "tab",
    });
  });
  it("{meta: foo bar} is meta foo/bar", () => {
    expect(lines("{meta: foo bar}")[0]).toStrictEqual({
      kind: "meta",
      name: "foo",
      value: "bar",
    });
    expect(lines("{meta: Direction  rtl  x }")[0]).toStrictEqual({
      kind: "meta",
      name: "direction",
      value: "rtl  x",
    });
    expect(lines("{meta: foo}")[0]).toStrictEqual({
      kind: "meta",
      name: "foo",
      value: "",
    });
  });
  it("{meta} and {meta:} are directives", () => {
    expect(lines("{meta}\n{meta:}")).toStrictEqual([
      { kind: "directive", name: "meta" },
      { kind: "directive", name: "meta" },
    ]);
  });
  it("{Title: x} is meta title; {t:}/{st:} aliases set song.title", () => {
    expect(lines("{Title: x}")[0]).toStrictEqual({
      kind: "meta",
      name: "title",
      value: "x",
    });
    const r = parseSong("{t: x}\n{st: y}");
    expect(r.song.lines).toStrictEqual([
      { kind: "meta", name: "title", value: "x" },
      { kind: "meta", name: "subtitle", value: "y" },
    ]);
    expect(r.song.title).toBe("x");
  });
  it("title and key come from the first meta line; empty leaves them absent", () => {
    const r = parseSong("{title: a}\n{title: b}\n{key: Am}\n{meta: key C}");
    expect(r.song).toMatchObject({ title: "a", key: "Am" });
    const e = parseSong("{title:}\n{key:  }");
    expect("title" in e.song).toBe(false);
    expect("key" in e.song).toBe(false);
  });
  it("tag names are case-insensitive; unknown tags are directives", () => {
    expect(lines("{NEW_KEY: G}\n{new_page}\n{X-y: }")).toStrictEqual([
      { kind: "directive", name: "new_key", value: "G" },
      { kind: "directive", name: "new_page" },
      { kind: "directive", name: "x-y" },
    ]);
  });
  it.each([
    ["comment", "normal"],
    ["c", "normal"],
    ["comment_italic", "italic"],
    ["ci", "italic"],
    ["comment_box", "box"],
    ["cb", "box"],
  ] as const)("comment alias {%s: t}", (tag, style) => {
    expect(lines(`{${tag}: t}`)[0]).toStrictEqual({
      kind: "comment",
      style,
      text: "t",
    });
    expect(lines(`{${tag}:}`)[0]).toStrictEqual({
      kind: "comment",
      style,
      text: "",
    });
  });
  it.each([
    ["soc", "eoc", "chorus"],
    ["sov", "eov", "verse"],
    ["sob", "eob", "bridge"],
    ["sot", "eot", "tab"],
    ["sog", "eog", "grid"],
    ["start_of_ly", "end_of_ly", "ly"],
    ["start_of_Custom_1", "end_of_custom_1", "custom_1"],
  ])("section tags {%s}/{%s}", (s, e, section) => {
    expect(lines(`{${s}: L}\n{${e}}`)).toStrictEqual([
      { kind: "section", edge: "start", section, label: "L" },
      { kind: "section", edge: "end", section },
    ]);
  });
  it("{eov: x} is a section end with no label", () => {
    expect(lines("{sov}\n{eov: x}")[1]).toStrictEqual({
      kind: "section",
      edge: "end",
      section: "verse",
    });
  });
  it("anchors a chord inside a niqqud cluster at the next cluster", () => {
    const line = lines("ש[Am]ָלום")[0];
    if (line?.kind !== "lyric") throw new Error("expected lyric");
    expect(line.chords).toStrictEqual([{ index: 1, chord: "Am" }]);
  });
  it("keeps a stray ] and { } in lyric text", () => {
    expect(lines("a] {b} c")[0]).toStrictEqual({
      kind: "lyric",
      lyric: "a] {b} c",
      chords: [],
    });
  });
  it("omits absent fields (no undefined-valued keys)", () => {
    const r = parseSong("a");
    expect(Object.keys(r.song)).toStrictEqual(["lines"]);
    expect(r.song.lines[0]).toStrictEqual({
      kind: "lyric",
      lyric: "a",
      chords: [],
    });
  });
  it("prototype-named tags are directives and round-trip", () => {
    for (const src of ["{constructor}", "{__proto__}", "{constructor: x}"]) {
      const m = /^\{(\w+)(?:: (.*))?\}$/.exec(src)!;
      expect(lines(src)).toStrictEqual([
        m[2] === undefined
          ? { kind: "directive", name: m[1] }
          : { kind: "directive", name: m[1], value: m[2] },
      ]);
      expect(serializeSong(parseSong(src).song)).toBe(src + "\n");
    }
  });
});
