import { describe, expect, it } from "vitest";
import {
  DOC_FIXTURE_NAMES,
  readDocAnchors,
  readDocExpected,
} from "test-fixtures";
import {
  documentToText,
  type DocumentBlock,
  type DocumentFormat,
} from "./documentText";
import { importText } from "./import";
import { splitGraphemes } from "./graphemes";
import { parseSong } from "./song";

const LYRIC = "אבג דהו זחט יכל";

function para(text: string): DocumentBlock {
  return { kind: "paragraph", text };
}

function convert(blocks: DocumentBlock[], format: DocumentFormat = "docx") {
  return documentToText({ format, blocks });
}

function anchorsOf(
  text: string,
  rtlColumns: "mirror" | "logical",
  lyric: string,
) {
  const { chordpro } = importText(text, { rtlColumns });
  const line = parseSong(chordpro).song.lines.find(
    (l) => l.kind === "lyric" && l.lyric === lyric,
  );
  if (line === undefined || line.kind !== "lyric") return null;
  return line.chords.map((c) => [c.chord, c.index] as const);
}

describe("documentToText paragraphs", () => {
  it("empty input is empty text", () => {
    expect(convert([]).text).toBe("");
  });

  it("keeps tabs and newlines, drops CR, ends with one newline", () => {
    const r = convert([para("a\tb\r\nc"), para("d"), para("")]);
    expect(r.text).toBe("a\tb\nc\nd\n");
  });

  it("rtlColumns is mirror for every format", () => {
    for (const f of ["docx", "odt", "rtf", "pdf"] as const) {
      expect(convert([para("x")], f).rtlColumns).toBe("mirror");
    }
  });
});

describe("documentToText RTL chord lines (R4)", () => {
  it("pads the chord line and anchors G at 0 and Am at 8", () => {
    const { text, rtlColumns } = convert([para(`Am      G`), para(LYRIC)]);
    expect(text.split("\n")[0]).toBe(`      Am      G`);
    expect(anchorsOf(text, rtlColumns, LYRIC)).toEqual([
      ["G", 0],
      ["Am", 8],
    ]);
  });

  it("moves leading spaces to the right edge", () => {
    const { text, rtlColumns } = convert([para(`    Am  G`), para(LYRIC)]);
    expect(anchorsOf(text, rtlColumns, LYRIC)).toEqual([
      ["G", 4],
      ["Am", 8],
    ]);
  });

  it("ignores trailing spaces", () => {
    const { text, rtlColumns } = convert([para(`Am  G   `), para(LYRIC)]);
    expect(anchorsOf(text, rtlColumns, LYRIC)).toEqual([
      ["G", 0],
      ["Am", 4],
    ]);
  });

  it("does not pad a chord line longer than its lyric", () => {
    const long = "Am     G     C     D     E     F     B";
    const { text } = convert([para(long), para("אבג")]);
    expect(text.split("\n")[0]).toBe(long);
  });

  it("does not pad a chord line before an English lyric", () => {
    const { text } = convert([para("Am  G"), para("Walking down the road")]);
    expect(text).toBe("Am  G\nWalking down the road\n");
  });

  it("does not pad pdf input", () => {
    const { text } = convert([para("Am  G"), para(LYRIC)], "pdf");
    expect(text).toBe(`Am  G\n${LYRIC}\n`);
  });

  it("expands tabs in the displayed form", () => {
    const { text } = convert([para("Am\tG"), para(LYRIC)]);
    expect(text.split("\n")[0]).toBe(" ".repeat(15 - 9) + "Am      G");
    expect(splitGraphemes(text.split("\n")[0] ?? "")).toHaveLength(15);
  });
});

describe("documentToText tables", () => {
  const table = (rows: string[][]): DocumentBlock => ({ kind: "table", rows });

  it("merges a chord row with the lyric row below", () => {
    const r = convert([
      table([
        ["Am", "", "F"],
        ["Walking out", "into the", "road"],
      ]),
    ]);
    expect(r.text).toBe("[Am]Walking out into the [F]road\n");
  });

  it("joins directly after a hyphen, removing it", () => {
    const r = convert([
      table([
        ["Am", "G"],
        ["morn-", "ing"],
      ]),
    ]);
    expect(r.text).toBe("[Am]morn[G]ing\n");
  });

  it("joins directly when whitespace is already at the join", () => {
    const r = convert([
      table([
        ["", "G"],
        ["walk ", "home"],
      ]),
    ]);
    expect(r.text).toBe("walk [G]home\n");
  });

  it("puts several chords of one cell in order", () => {
    const r = convert([
      table([
        ["Am G", "C"],
        ["go", "on"],
      ]),
    ]);
    expect(r.text).toBe("[Am][G]go [C]on\n");
  });

  it("turns inner newlines of a lyric cell into spaces", () => {
    const r = convert([table([["Am"], ["one\ntwo"]])]);
    expect(r.text).toBe("[Am]one two\n");
  });

  it("gives chords alone when the lyric row is shorter", () => {
    const r = convert([table([["Am", "G"], ["go"]])]);
    expect(r.text).toBe("[Am]go [G]\n");
  });

  it("a chord row with no lyric row becomes chords only", () => {
    const r = convert([table([["Am", "", "G"]])]);
    expect(r.text).toBe("[Am] [G]\n");
    const r2 = convert([
      table([
        ["Am", "G"],
        ["", ""],
        ["C", "D"],
      ]),
    ]);
    expect(r2.text).toBe("[Am] [G]\n\n[C] [D]\n");
  });

  it("joins a label row's cells with one space", () => {
    const r = convert([table([[" Verse ", "", " 1 "]])]);
    expect(r.text).toBe("Verse 1\n");
  });

  it("a row with one non-chord token is not a chord row", () => {
    const r = convert([
      table([
        ["Am Verse", "G"],
        ["go", "on"],
      ]),
    ]);
    expect(r.text).toBe("Am Verse G\ngo on\n");
  });

  it("a blank row is an empty line", () => {
    const r = convert([table([["a"], ["", " "], ["b"]])]);
    expect(r.text).toBe("a\n\nb\n");
  });
});

describe("documentToText fixtures", () => {
  it.each(DOC_FIXTURE_NAMES)("%s imports without syntax errors", (name) => {
    const blocks = readDocExpected(name) as DocumentBlock[];
    const { text, rtlColumns } = documentToText({ format: "docx", blocks });
    const { chordpro } = importText(text, { rtlColumns });
    const syntax = parseSong(chordpro).diagnostics.filter(
      (d) => d.code === "syntax",
    );
    expect(syntax).toEqual([]);
  });

  it("en_table anchors chords on the expected words", () => {
    const blocks = readDocExpected("en_table") as DocumentBlock[];
    const { text, rtlColumns } = documentToText({ format: "docx", blocks });
    const first = "Walking out into the morning light";
    expect(anchorsOf(text, rtlColumns, first)).toEqual([
      ["Am", 0],
      ["F", 21],
      ["C", 29],
    ]);
    const second = "Nothing left to carry now";
    expect(anchorsOf(text, rtlColumns, second)).toEqual([
      ["G", 0],
      ["Am", 16],
    ]);
  });

  it("he_chords_above meets every rendered anchor", () => {
    const blocks = readDocExpected("he_chords_above") as DocumentBlock[];
    const { text, rtlColumns } = documentToText({ format: "docx", blocks });
    expect(rtlColumns).toBe("mirror");
    const { chordpro } = importText(text, { rtlColumns });
    const lines = parseSong(chordpro).song.lines;
    for (const entry of readDocAnchors()) {
      const line = lines.find(
        (l) => l.kind === "lyric" && l.lyric === entry.line,
      );
      expect(line, entry.line).toBeDefined();
      if (line === undefined || line.kind !== "lyric") continue;
      const hit = line.chords.find(
        (c) => c.chord === entry.chord && c.index === entry.index,
      );
      expect(hit, `${entry.line} ${entry.chord}@${entry.index}`).toBeDefined();
    }
  });
});
