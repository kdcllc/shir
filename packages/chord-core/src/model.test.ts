import { describe, expect, it } from "vitest";
import { LINE_KINDS, META_NAMES, type LineKind, type SongLine } from "./model";

function assertNever(x: never): never {
  throw new Error(`unexpected kind: ${JSON.stringify(x)}`);
}

/** Exhaustive over SongLine: fails typecheck if a kind is missing. */
function kindOf(line: SongLine): LineKind {
  switch (line.kind) {
    case "lyric":
    case "chords":
    case "empty":
    case "meta":
    case "comment":
    case "section":
    case "tab":
    case "remark":
    case "directive":
    case "raw":
      return line.kind;
    default:
      return assertNever(line);
  }
}

/** Fails typecheck unless LINE_KINDS covers exactly LineKind. */
const _coversUnion: readonly LineKind[] = LINE_KINDS;
const _missing: Exclude<LineKind, (typeof LINE_KINDS)[number]> extends never
  ? true
  : never = true;

describe("model contract", () => {
  it("LINE_KINDS has 10 unique kinds in order", () => {
    expect([...LINE_KINDS]).toEqual([
      "lyric",
      "chords",
      "empty",
      "meta",
      "comment",
      "section",
      "tab",
      "remark",
      "directive",
      "raw",
    ]);
    expect(new Set(LINE_KINDS).size).toBe(10);
    expect(_coversUnion).toBe(LINE_KINDS);
    expect(_missing).toBe(true);
  });

  it("switch over SongLine kinds is exhaustive", () => {
    expect(kindOf({ kind: "raw", text: "x" })).toBe("raw");
    expect(kindOf({ kind: "empty" })).toBe("empty");
  });

  it("META_NAMES matches the contract", () => {
    expect([...META_NAMES]).toEqual([
      "title",
      "subtitle",
      "artist",
      "composer",
      "lyricist",
      "album",
      "year",
      "key",
      "capo",
      "tempo",
      "time",
      "duration",
      "copyright",
      "direction",
    ]);
  });
});
