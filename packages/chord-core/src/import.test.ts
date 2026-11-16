import { describe, expect, it } from "vitest";
import {
  IMPORT_FIXTURE_NAMES,
  hasLogicalGolden,
  readImportGolden,
  readImportInput,
} from "test-fixtures";
import { importText } from "./import";
import { importText as importFromIndex } from "./index";
import { parseSong } from "./song";

describe("importText fixtures", () => {
  it.each(IMPORT_FIXTURE_NAMES)("%s equals its golden (mirror)", (name) => {
    expect(importText(readImportInput(name)).chordpro).toBe(
      readImportGolden(name),
    );
  });

  it.each(IMPORT_FIXTURE_NAMES)(
    "%s equals its logical golden where one exists",
    (name) => {
      if (!hasLogicalGolden(name)) return;
      expect(
        importText(readImportInput(name), { rtlColumns: "logical" }).chordpro,
      ).toBe(readImportGolden(name, "logical"));
    },
  );

  it.each(IMPORT_FIXTURE_NAMES)(
    "%s output parses without diagnostics",
    (name) => {
      const { chordpro } = importText(readImportInput(name));
      expect(parseSong(chordpro).diagnostics).toEqual([]);
    },
  );

  it.each(IMPORT_FIXTURE_NAMES)("%s is idempotent on re-import", (name) => {
    const first = importText(readImportInput(name));
    const again = importText(first.chordpro);
    expect(again.format).toBe("chordpro");
    expect(again.chordpro).toBe(first.chordpro);
  });

  it("is exported from the package index", () => {
    expect(importFromIndex("Am\nhello").chordpro).toBe("[Am]hello");
  });
});

describe("per-line classification", () => {
  it("per-line: directive header + Hebrew chords-over-lyrics", () => {
    const input = readImportInput("header_he_over_lyrics");
    for (const rtlColumns of ["mirror", "logical"] as const) {
      const r = importText(input, { rtlColumns });
      expect(r.chordpro).toBe(
        readImportGolden(
          "header_he_over_lyrics",
          rtlColumns === "logical" ? "logical" : undefined,
        ),
      );
      expect(r.format).toBe("chords-over-lyrics");
      expect(r.hasRtlChords).toBe(true);
      const out = r.chordpro.split("\n");
      for (const line of input.split("\n")) {
        if (line.startsWith("{") || line.includes("[F]")) {
          expect(out).toContain(line);
        }
      }
    }
  });

  it("chordpro_passthrough returns chordpro unchanged", () => {
    const input = readImportInput("chordpro_passthrough");
    const r = importText(input);
    expect(r.format).toBe("chordpro");
    expect(r.chordpro).toBe(input);
    expect(r.hasRtlChords).toBe(false);
    expect(r.warnings).toEqual([]);
  });
});

describe("literal sections", () => {
  it("literal-section: tab block passes through", () => {
    const input = readImportInput("chordpro_passthrough");
    const r = importText(input);
    expect(r.chordpro).toBe(input);
    expect(r.chordpro).toContain("   Am      C\ne|---0---|---1---|");
  });

  it("literal-section: tab block next to a chord sheet is not merged", () => {
    const src = "{start_of_tab}\n Am  C\ne|--0--|\n{end_of_tab}\nAm\nhello";
    const r = importText(src);
    expect(r.chordpro).toBe(
      "{start_of_tab}\n Am  C\ne|--0--|\n{end_of_tab}\n[Am]hello",
    );
  });

  it("literal-section: {sot} ... {EOT} alias in mixed case", () => {
    const src = "{SoT}\n Am  C\nabc\n {EOT}\nC\nword";
    expect(importText(src).chordpro).toBe(
      "{SoT}\n Am  C\nabc\n {EOT}\n[C]word",
    );
  });

  it("literal-section: unterminated start_of_grid stays passthrough", () => {
    const src = "{start_of_grid}\nAm C\nword\nG\nmore";
    const r = importText(src);
    expect(r.chordpro).toBe(src);
    expect(r.format).toBe("chordpro");
  });

  it("literal-section: end tag must match the start kind", () => {
    const src = "{start_of_tab}\nAm\nword\n{end_of_grid}\nC\nx";
    expect(importText(src).chordpro).toBe(src);
  });
});

describe("mirror bidi runs", () => {
  // Simplified UAX #9 gaps (see import.ts): W4/W5 number separators
  // (`1,000`, `5%` inside RTL) are plain neutrals, and Arabic-Indic digits are
  // classed R as RTL script graphemes (not AN). These are not asserted as
  // correct behaviour, only documented.
  it("mirror: LTR run inside RTL lyric keeps LTR order", () => {
    // Visual order: ם ו ל ש | abc | ם ל ו ע  (RTL runs reversed, Latin kept)
    const lyric = "שלום abc עולם";
    // chord over the Latin 'a' (visual col 5) lands on it; over Hebrew per rule 2.
    const out = importText(`G    Em   C\n${lyric}`).chordpro;
    expect(out).toBe("שלו[G]ם [Em]abc עו[C]לם");
  });

  it("mirror: digit run in RTL context keeps digits LTR (level 2)", () => {
    const lyric = "שלום 123 עולם";
    expect(importText(`      A\n${lyric}`).chordpro).toBe("שלום 1[A]23 עולם");
    expect(importText(`   C\n${lyric}`).chordpro).toBe("שלום 123 [C]עולם");
    expect(importText(`           Dm\n${lyric}`).chordpro).toBe(
      "[Dm]שלום 123 עולם",
    );
  });

  it("mirror: chord span straddling an RTL to LTR boundary", () => {
    // visual: ב א _ c d ; Em spans cols 1-2 (RTL letter then the neutral).
    expect(importText(" Em\nאב cd").chordpro).toBe("אב [Em]cd");
    // committed fixture: Dm7 at [5,8) lands on `[Dm7]blues`
    expect(readImportGolden("mixed_over_lyrics")).toContain("[Dm7]bl");
  });

  it("mirror: chord beyond an RTL lyric clamps to grapheme 0", () => {
    const r = importText(readImportInput("he_over_lyrics"));
    expect(r.chordpro).toBe(readImportGolden("he_over_lyrics"));
    expect(r.chordpro).toContain("[Dm7]לילה");
    expect(r.warnings).toEqual([
      expect.objectContaining({ code: "chord-past-end", line: 5 }),
    ]);
  });

  it("mixed_over_lyrics matches its mirror golden", () => {
    expect(importText(readImportInput("mixed_over_lyrics")).chordpro).toBe(
      readImportGolden("mixed_over_lyrics"),
    );
  });
});

describe("normalization and structure", () => {
  it("strips one BOM and normalizes CRLF and CR", () => {
    const r = importText("﻿Am\r\nhello\rworld\r\n");
    expect(r.chordpro).toBe("[Am]hello\nworld\n");
  });

  it("chord-only line, chord before blank, chord at EOF", () => {
    expect(importText("Am G\nxyzw").chordpro).toBe("[Am]xyz[G]w");
    expect(importText("Am G C").chordpro).toBe("[Am] [G] [C]");
    expect(importText("Am G\n\nword").chordpro).toBe("[Am] [G]\n\nword");
    expect(importText("word\nAm  G\n").chordpro).toBe("word\n[Am] [G]\n");
  });

  it("trailing newline state is preserved", () => {
    expect(importText("Am\nhi\n").chordpro).toBe("[Am]hi\n");
    expect(importText("Am\nhi").chordpro).toBe("[Am]hi");
  });

  it("pins the chord-like lyric heuristic", () => {
    const r = importText("A");
    expect(r.chordpro).toBe("[A]");
    expect(r.format).toBe("chords-over-lyrics");
    expect(importText("Am Em").chordpro).toBe("[Am] [Em]");
  });

  it("two chord lines in a row: first is chord-only", () => {
    expect(importText("Am\nG\nword").chordpro).toBe("[Am]\n[G]word");
  });

  it("snaps forward off whitespace", () => {
    expect(importText("  C\nab cd").chordpro).toBe("ab [C]cd");
    expect(importText("C   \nab").chordpro).toBe("[C]ab");
  });

  it("keeps source order for two chords on the same index", () => {
    expect(importText("A B\n  xy").chordpro).toBe("  [A][B]xy");
  });

  it("expands tabs on chord lines to multiples of 8", () => {
    expect(importText("\tAm\nabcdefghij").chordpro).toBe("abcdefgh[Am]ij");
    expect(importText("A\tB\nabcdefghij").chordpro).toBe("[A]abcdefgh[B]ij");
  });

  it("places chords on grapheme boundaries (niqqud stays attached)", () => {
    const out = importText("  C\nשָׁלום", { rtlColumns: "logical" }).chordpro;
    expect(out).toBe("שָׁל[C]ום");
  });
});

describe("warnings", () => {
  it("chord-past-end in LTR with the chord line number", () => {
    const r = importText("x\n\nAm     G\nab");
    expect(r.chordpro).toBe("x\n\n[Am]ab[G]");
    expect(r.warnings).toEqual([
      expect.objectContaining({ code: "chord-past-end", line: 3 }),
    ]);
  });

  it("chord-past-end in RTL logical mode", () => {
    const r = importText("Am     G\nשלום", { rtlColumns: "logical" });
    expect(r.chordpro).toBe("[Am]שלום[G]");
    expect(r.warnings.map((w) => w.code)).toEqual(["chord-past-end"]);
  });

  it("no-chords warning at line 1", () => {
    const r = importText("hello\nworld");
    expect(r.format).toBe("chordpro");
    expect(r.chordpro).toBe("hello\nworld");
    expect(r.warnings).toEqual([
      expect.objectContaining({ code: "no-chords", line: 1 }),
    ]);
  });

  it("no no-chords warning when inline chords exist", () => {
    expect(importText("[Am]hello").warnings).toEqual([]);
  });
});

describe("hasRtlChords", () => {
  it("is true for an RTL merge, false for LTR, chord-only and passthrough", () => {
    expect(importText("Am\nשלום").hasRtlChords).toBe(true);
    expect(importText("Am\nhello").hasRtlChords).toBe(false);
    expect(importText("Am G\n\nשלום").hasRtlChords).toBe(false);
    expect(importText("[Am]שלום").hasRtlChords).toBe(false);
  });
});

describe("robustness", () => {
  it("prototype-named tokens are plain lyric words and never throw", () => {
    const words = [
      "constructor",
      "__proto__",
      "toString",
      "hasOwnProperty",
      "valueOf",
    ];
    const line = words.join(" ");
    const r = importText(line);
    expect(r.format).toBe("chordpro");
    expect(r.chordpro).toBe(line);
    for (const w of words) {
      expect(importText(w).format).toBe("chordpro");
      expect(importText(`Am\n${w}`).chordpro).toBe(`[Am]${w}`);
      expect(importText(`Am ${w}\nx`).chordpro).toBe(`Am ${w}\nx`);
    }
    expect(importText("{start_of___proto__}\nAm\nconstructor").chordpro).toBe(
      "{start_of___proto__}\n[Am]constructor",
    );
  });

  it("never throws on malformed input", () => {
    for (const s of ["", "   ", "[", "{", "]", "[]", "\n\n", "{start_of_tab"]) {
      expect(() => importText(s)).not.toThrow();
    }
    expect(importText("").chordpro).toBe("");
    expect(importText("[").chordpro).toBe("[");
  });
});
