import { describe, expect, it } from "vitest";
import { parseSong } from "./song";

/**
 * `parseSong` drops the piece after the final "\n" so a trailing newline does not add a phantom
 * line. These tests prove that the dropped piece is always an empty line: no text is lost.
 */
const BODIES = ["[C]la [G]la", "שלום [Am]עולם", "{title: T}"] as const;

describe("parseSong end-of-file drop", () => {
  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ] as const)("the piece dropped after a final %s is empty", (_name, eol) => {
    for (const body of BODIES) {
      const source = `${body}${eol}`;
      const pieces = source.split("\n");
      // The dropped piece is exactly the last one, and it holds no text at all.
      expect(pieces[pieces.length - 1]).toBe("");
      expect(pieces.slice(0, -1).join("\n")).toBe(`${body}${eol.slice(0, -1)}`);
      // Nothing was lost: the trailing newline adds no line.
      const withEol = parseSong(source).song.lines;
      expect(withEol).toHaveLength(pieces.length - 1);
      expect(withEol).toStrictEqual(parseSong(body).song.lines);
    }
  });

  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ] as const)(
    "a blank line before the final %s is kept as an empty line, not dropped",
    (_name, eol) => {
      const source = `[C]la${eol}${eol}`;
      const lines = parseSong(source).song.lines;
      expect(lines).toHaveLength(2);
      expect(lines[1]).toStrictEqual({ kind: "empty" });
    },
  );

  it("a source of only a newline is one empty line; an empty source has none", () => {
    expect(parseSong("\n").song.lines).toStrictEqual([{ kind: "empty" }]);
    expect(parseSong("\r\n").song.lines).toStrictEqual([{ kind: "empty" }]);
    expect(parseSong("").song.lines).toStrictEqual([]);
  });

  it("a final line without a newline is never dropped", () => {
    expect(parseSong("a\nb").song.lines).toHaveLength(2);
    expect(parseSong("a\r\nb").song.lines).toHaveLength(2);
  });
});
