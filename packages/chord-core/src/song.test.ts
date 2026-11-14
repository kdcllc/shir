import { describe, expect, it, vi } from "vitest";
import { FIXTURE_NAMES, readFixture, readGolden } from "test-fixtures";
import type { SongModel } from "./model";
import { splitGraphemes } from "./graphemes";
import { parseSong } from "./song";

describe("parseSong goldens", () => {
  it.each(FIXTURE_NAMES)("matches golden for %s", (name) => {
    expect(parseSong(readFixture(name))).toEqual(readGolden(name));
  });

  it("golden comparison is non-vacuous", () => {
    const golden = structuredClone(readGolden("he_plain")) as SongModel;
    const line = golden.lines.find(
      (l) => l.kind === "lyric" && l.chords.length > 0,
    );
    if (line?.kind !== "lyric") throw new Error("no lyric line");
    line.chords[0]!.index += 1;
    expect(parseSong(readFixture("he_plain"))).not.toEqual(golden);
  });
});

describe("parseSong targeted", () => {
  it("parses CRLF identically to LF", () => {
    const lf = "{title: T}\n{meta: direction rtl}\n[Am]שלום\n\nעולם\n";
    expect(parseSong(lf.replace(/\n/g, "\r\n"))).toEqual(parseSong(lf));
  });
  it("returns no lines for empty input", () => {
    expect(parseSong("")).toEqual({ lines: [] });
  });
  it("drops only the line after a final newline", () => {
    expect(parseSong("a\n").lines).toHaveLength(1);
    expect(parseSong("a\n\n").lines).toEqual([
      { kind: "lyric", lyric: "a", chords: [] },
      { kind: "empty" },
    ]);
  });
  it("sets direction only for rtl/ltr", () => {
    expect(
      parseSong("{meta: direction rtl}\n{meta: direction ltr}\na\n").direction,
    ).toBeUndefined();
    expect(
      parseSong("{meta: direction rtl}\n{meta: direction rtl}\na\n").direction,
    ).toBe("rtl");
    expect(parseSong("{meta: direction up}\na\n").direction).toBeUndefined();
    expect(parseSong("{direction: RTL}\na\n").direction).toBe("rtl");
  });
  it("anchors a chord at end of line at graphemeCount", () => {
    const line = parseSong("abc[G]\n").lines[0];
    expect(line).toEqual({
      kind: "lyric",
      lyric: "abc",
      chords: [{ index: 3, chord: "G" }],
    });
  });
  it("counts niqqud as one grapheme", () => {
    const line = parseSong("שָׁ[Am]לום\n").lines[0];
    if (line?.kind !== "lyric") throw new Error("expected lyric");
    expect(line.chords).toEqual([{ index: 1, chord: "Am" }]);
    expect(splitGraphemes(line.lyric)).toHaveLength(4);
  });
  it("anchors mid-word chords", () => {
    const line = parseSong("ro[C#]ll\n").lines[0];
    expect(line).toEqual({
      kind: "lyric",
      lyric: "roll",
      chords: [{ index: 2, chord: "C#" }],
    });
  });
  it("maps chord-only lines", () => {
    expect(parseSong("[Am] [G] [F]\n").lines[0]).toEqual({
      kind: "chords",
      chords: ["Am", "G", "F"],
    });
  });
  it("wraps parse errors with a prefix and cause", () => {
    let caught: unknown;
    try {
      parseSong("{title");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message.startsWith("parseSong: ")).toBe(true);
    expect((caught as Error).cause).toBeDefined();
  });
});

describe("parseSong with mocked parser failure", () => {
  it("rethrows with prefix and original cause", async () => {
    vi.resetModules();
    const boom = new Error("boom");
    vi.doMock("chordsheetjs", async (orig) => {
      const actual = await orig<typeof import("chordsheetjs")>();
      return {
        ...actual,
        ChordProParser: class {
          parse(): never {
            throw boom;
          }
        },
      };
    });
    const { parseSong: mocked } = await import("./song");
    try {
      mocked("x");
      throw new Error("did not throw");
    } catch (e) {
      expect((e as Error).message).toBe("parseSong: boom");
      expect((e as Error).cause).toBe(boom);
    }
    vi.doUnmock("chordsheetjs");
  });
});
