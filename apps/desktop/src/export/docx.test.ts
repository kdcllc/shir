import { strFromU8, unzipSync } from "fflate";
import type { ExportDocument } from "chord-core";
import { describe, expect, it } from "vitest";
import { estimateColumnWidths, fitColumnWidths } from "./columnWidths";
import { buildDocx } from "./docx";
import {
  docOf,
  entry,
  inlineEntry,
  LABELS,
  META,
  type ExportDocumentLike,
} from "./testSupport";

async function documentXml(
  doc: ExportDocumentLike,
  cover = false,
  meta = META,
): Promise<Document> {
  const bytes = await buildDocx(doc, { cover, labels: LABELS, meta });
  const xml = strFromU8(unzipSync(bytes)["word/document.xml"] as Uint8Array);
  return new DOMParser().parseFromString(xml, "application/xml");
}

const all = (el: Element | Document, tag: string): Element[] =>
  Array.from(el.getElementsByTagName(tag));
const has = (el: Element, tag: string): boolean =>
  el.getElementsByTagName(tag).length > 0;
const text = (el: Element): string =>
  all(el, "w:t")
    .map((t) => t.textContent ?? "")
    .join("");
const rows = (tbl: Element): Element[] =>
  all(tbl, "w:tr").filter((r) => r.parentElement === tbl);
const cellsOf = (row: Element): Element[] => all(row, "w:tc");
const runsOf = (el: Element): Element[] => all(el, "w:r");
const rtlRuns = (el: Element): Element[] =>
  runsOf(el).filter((r) => has(r, "w:rtl"));
/** The mixed line's table: the one holding an English cell. */
const tableWith = (d: Document, needle: string): Element =>
  all(d, "w:tbl").find((t) => text(t).includes(needle)) as Element;
const sizeOf = (tc: Element, side: "left" | "right"): number => {
  const mar = tc.getElementsByTagName("w:tcMar")[0] as Element;
  const el = mar.getElementsByTagName(`w:${side}`)[0] as Element;
  return Number(el.getAttribute("w:w"));
};
/** `w:jc` of the cell's (single) paragraph, not of the table. */
const paraJc = (tc: Element): string | null => {
  const p = tc.getElementsByTagName("w:p")[0] as Element;
  const jc = p.getElementsByTagName("w:jc")[0];
  return jc ? jc.getAttribute("w:val") : null;
};
const LTR_META = { lang: "en", dir: "ltr", dateText: "x" } as const;

describe("buildDocx output", () => {
  it("is a zip with an A4 portrait page and 2 cm margins", async () => {
    const d = await documentXml(docOf("T", [entry("he_niqqud")]));
    const pgSz = all(d, "w:pgSz")[0] as Element;
    expect(pgSz.getAttribute("w:w")).toBe("11906");
    expect(pgSz.getAttribute("w:h")).toBe("16838");
    const mar = all(d, "w:pgMar")[0] as Element;
    for (const side of ["top", "bottom", "left", "right"]) {
      expect(mar.getAttribute(`w:${side}`)).toBe("1134");
    }
  });

  it("builds a Hebrew lyric line as a bidiVisual table with rtl lyric runs and no rtl chords", async () => {
    const d = await documentXml(docOf("T", [entry("he_niqqud")]));
    const tables = all(d, "w:tbl");
    expect(tables.length).toBe(3);
    for (const tbl of tables) {
      expect(has(tbl, "w:bidiVisual")).toBe(true);
      const [chordRow, lyricRow] = rows(tbl) as [Element, Element];
      expect(runsOf(chordRow).length).toBeGreaterThan(0);
      expect(rtlRuns(chordRow)).toHaveLength(0);
      for (const r of runsOf(chordRow)) expect(has(r, "w:b")).toBe(true);
      for (const tc of cellsOf(chordRow)) {
        expect(has(tc, "w:bidi")).toBe(false);
        expect(paraJc(tc)).toBe("right");
      }
      for (const tc of cellsOf(lyricRow)) {
        if (text(tc) === "") continue;
        expect(has(tc, "w:bidi")).toBe(true);
        expect(rtlRuns(tc).length).toBe(runsOf(tc).length);
      }
    }
  });

  it("emits none of bidiVisual, bidi or rtl for an English line", async () => {
    const d = await documentXml(docOf("T", [entry("en_plain")]), false, {
      lang: "en",
      dir: "ltr",
      dateText: "x",
    });
    expect(all(d, "w:tbl").length).toBeGreaterThan(0);
    expect(all(d, "w:bidiVisual")).toHaveLength(0);
    expect(all(d, "w:bidi")).toHaveLength(0);
    expect(all(d, "w:rtl")).toHaveLength(0);
  });

  it("orders mixed_he_en cells so rock and r renders left of oll, with no rtl runs on them", async () => {
    const d = await documentXml(
      docOf("T", [entry("mixed_he_en", { transpose: 2 })]),
    );
    const tbl = tableWith(d, "oll");
    expect(has(tbl, "w:bidiVisual")).toBe(true);
    const [chordRow, lyricRow] = rows(tbl) as [Element, Element];
    const cells = cellsOf(lyricRow);
    expect(cells.map(text)).toEqual([
      "אנחנו שרים ",
      "oll",
      "rock and r",
      " עד הבוקר",
    ]);
    // Reversed group concatenates back to the logical lyric.
    const logical = [cells[0], cells[2], cells[1], cells[3]]
      .map((c) => text(c as Element))
      .join("");
    expect(logical).toBe("אנחנו שרים rock and roll עד הבוקר");
    for (const i of [1, 2]) {
      expect(rtlRuns(cells[i] as Element)).toHaveLength(0);
      expect(has(cells[i] as Element, "w:bidi")).toBe(false);
    }
    for (const i of [0, 3]) expect(rtlRuns(cells[i] as Element).length).toBe(1);
    // Chords follow their cells: the chord of "rock and r" (G, +2 = A) stays with it.
    const chords = cellsOf(chordRow).map(text);
    expect(chords).toHaveLength(4);
    expect(chords[2]).not.toBe("");
    expect(chords[1]).not.toBe("");
    expect(rtlRuns(chordRow)).toHaveLength(0);
  });

  it("keeps a non-zero end margin on every chord cell (dense_chords, chord_only_line) and zero on lyric cells", async () => {
    for (const name of ["dense_chords", "chord_only_line"]) {
      const d = await documentXml(docOf("T", [entry(name)]));
      const tables = all(d, "w:tbl");
      expect(tables.length).toBeGreaterThan(0);
      for (const tbl of tables) {
        const [first, second] = rows(tbl);
        for (const tc of cellsOf(first as Element)) {
          // Both fixtures are rtl: the visual end of an rtl cell is the physical left.
          expect(sizeOf(tc, "left")).toBeGreaterThanOrEqual(85);
          expect(sizeOf(tc, "right")).toBe(0);
          expect(all(tc, "w:end")).toHaveLength(0);
        }
        if (second) {
          for (const tc of cellsOf(second)) {
            expect(sizeOf(tc, "left")).toBe(0);
            expect(sizeOf(tc, "right")).toBe(0);
          }
        }
      }
    }
  });

  it("sizes table columns from content (w:gridCol), mirrored by each w:tcW, with no w:tblLayout", async () => {
    for (const name of ["mixed_he_en", "dense_chords"]) {
      const d = await documentXml(docOf("T", [entry(name)]));
      const tables = all(d, "w:tbl");
      expect(tables.length).toBeGreaterThan(0);
      expect(all(d, "w:tblLayout")).toHaveLength(0);
      for (const tbl of tables) {
        const grid = all(tbl, "w:gridCol").map((g) =>
          Number(g.getAttribute("w:w")),
        );
        const [chordRow, lyricRow] = rows(tbl) as [Element, Element?];
        const chords = cellsOf(chordRow).map(text);
        const lyrics = lyricRow
          ? cellsOf(lyricRow).map(text)
          : chords.map(() => "");
        const cells = chords.map((chord, i) => ({
          chord,
          text: lyrics[i] as string,
        }));
        const expected = fitColumnWidths(estimateColumnWidths(cells), 9638);
        expect(grid).toEqual(expected);
        expect(grid).not.toEqual(
          cells.map(() => Math.round(9638 / cells.length)),
        );
        for (const row of rows(tbl)) {
          const widths = cellsOf(row).map((tc) =>
            Number(
              (tc.getElementsByTagName("w:tcW")[0] as Element).getAttribute(
                "w:w",
              ),
            ),
          );
          expect(widths).toEqual(grid);
        }
      }
    }
  });

  it("scales a too-wide line down to the printable width", async () => {
    const chords = Array.from({ length: 30 }, () => "[Am7/G]x").join("");
    const d = await documentXml(
      docOf("T", [inlineEntry(`{title: Wide}\n\n${chords}\n`)]),
      false,
      { lang: "en", dir: "ltr", dateText: "x" },
    );
    const grid = all(d, "w:gridCol").map((g) => Number(g.getAttribute("w:w")));
    expect(grid).toHaveLength(30);
    const sum = grid.reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThanOrEqual(9638 + grid.length);
    expect(sum).toBeGreaterThan(9638 - grid.length);
  });

  it("aligns rtl tables to the right margin (w:jc) and leaves ltr tables unaligned", async () => {
    const rtl = await documentXml(docOf("T", [entry("mixed_he_en")]));
    const rtlTables = all(rtl, "w:tbl");
    expect(rtlTables.length).toBeGreaterThan(0);
    for (const tbl of rtlTables) {
      const jc = all(tbl, "w:tblPr")[0]?.getElementsByTagName("w:jc")[0];
      expect(jc?.getAttribute("w:val")).toBe("right");
    }
    const ltr = await documentXml(docOf("T", [entry("en_plain")]), false, {
      lang: "en",
      dir: "ltr",
      dateText: "x",
    });
    expect(all(ltr, "w:tbl").length).toBeGreaterThan(0);
    for (const tbl of all(ltr, "w:tbl")) {
      expect(all(tbl, "w:tblPr")[0]?.getElementsByTagName("w:jc")).toHaveLength(
        0,
      );
    }
  });

  it("splits a chordless mixed lyric line into runs with w:rtl only on the rtl runs", async () => {
    const song = inlineEntry(
      "{title: Mixed}\n{meta: direction rtl}\n\nשלום world שלום\n",
    );
    const d = await documentXml(docOf("T", [song]));
    expect(all(d, "w:tbl")).toHaveLength(0);
    const p = all(d, "w:p").find((x) => text(x).includes("world")) as Element;
    expect(has(p, "w:bidi")).toBe(true);
    const runs = runsOf(p);
    expect(runs.map(text)).toEqual(["שלום ", "world", " שלום"]);
    expect(runs.map((r) => has(r, "w:rtl"))).toEqual([true, false, true]);
  });

  it("renders an rtl chords line as a bidiVisual table in logical chord order, never rtl", async () => {
    const d = await documentXml(docOf("T", [entry("chord_only_line")]));
    const chordTables = all(d, "w:tbl").filter((t) => rows(t).length === 1);
    expect(chordTables).toHaveLength(1);
    const tbl = chordTables[0] as Element;
    expect(has(tbl, "w:bidiVisual")).toBe(true);
    expect(cellsOf(rows(tbl)[0] as Element).map(text)).toEqual([
      "Am",
      "G",
      "F",
      "E",
    ]);
    expect(rtlRuns(tbl)).toHaveLength(0);
  });

  it("renders an ltr chords line without bidiVisual", async () => {
    const song = inlineEntry("{title: Road}\n\n[C] [G] [Am] [F]\n");
    const d = await documentXml(docOf("T", [song]), false, {
      lang: "en",
      dir: "ltr",
      dateText: "x",
    });
    const tbl = all(d, "w:tbl")[0] as Element;
    expect(cellsOf(rows(tbl)[0] as Element).map(text)).toEqual([
      "C",
      "G",
      "Am",
      "F",
    ]);
    expect(all(d, "w:bidiVisual")).toHaveLength(0);
  });

  it("keeps lyric segment text in logical order with niqqud intact", async () => {
    const d = await documentXml(docOf("T", [entry("he_niqqud")]));
    const lyric = all(d, "w:tbl").map((t) =>
      cellsOf(rows(t)[1] as Element)
        .map(text)
        .join(""),
    );
    const model = entry("he_niqqud").song.lines.flatMap((l) =>
      l.kind === "lyric" ? [l.lyric] : [],
    );
    expect(model).toHaveLength(3);
    expect(lyric).toEqual(model);
    expect(lyric[0]).toContain("\u05B8"); // niqqud survives
  });

  it("starts each song after the cover on a new page and lists every song on the cover", async () => {
    const doc = docOf("רשימה", [
      inlineEntry(
        "{title: שיר השלום}\n{meta: direction rtl}\n{key: G}\n\n[G]שלום\n",
      ),
      entry("en_plain", { capo: 2 }),
    ]);
    const d = await documentXml(doc, true);
    expect(all(d, "w:pageBreakBefore")).toHaveLength(2);
    const paras = all(d, "w:p").map(text);
    expect(paras[0]).toBe("רשימה");
    expect(paras[1]).toBe(`${LABELS.date}: ${META.dateText}`);
    expect(paras[2]).toBe(LABELS.songs);
    expect(paras[3]).toContain("1. שיר השלום");
    expect(paras[3]).toContain(`${LABELS.key}: `);
    expect(paras[4]).toContain("2. Morning Light");
    expect(paras[4]).toContain(`${LABELS.capo}: 2`);
    expect(paras[3]).not.toContain(LABELS.capo);
    // The page breaks sit on the song headings.
    const breaks = all(d, "w:p").filter((p) => has(p, "w:pageBreakBefore"));
    expect(breaks.map(text)).toEqual(["שיר השלום", "Morning Light"]);
  });

  it("has no cover and no leading page break for a single song without cover", async () => {
    const d = await documentXml(docOf("שיר", [entry("he_niqqud")]));
    expect(all(d, "w:pageBreakBefore")).toHaveLength(0);
    const paras = all(d, "w:p").map(text);
    expect(paras[0]).toBe("שיר השלום");
    expect(paras.join("|")).not.toContain(LABELS.songs);
    expect(paras.join("|")).not.toContain(LABELS.date);
  });

  it("puts a page break before every song after the first when there is no cover", async () => {
    const d = await documentXml(
      docOf("T", [entry("he_niqqud"), entry("en_plain")]),
    );
    expect(all(d, "w:pageBreakBefore")).toHaveLength(1);
  });

  it("maps section, comment and tab lines", async () => {
    const song = inlineEntry(
      [
        "{title: Kinds}",
        "{meta: direction rtl}",
        "{start_of_verse: בית}",
        "{comment: הערה}",
        "{start_of_tab}",
        "e|--0--|",
        "{end_of_tab}",
        "",
      ].join("\n"),
    );
    const d = await documentXml(docOf("T", [song]));
    const para = (needle: string): Element =>
      all(d, "w:p").find((p) => text(p).includes(needle)) as Element;
    const section = para("בית");
    expect(has(section, "w:b")).toBe(true);
    expect(has(section, "w:bidi")).toBe(true);
    const comment = para("הערה");
    expect(has(comment, "w:i")).toBe(true);
    expect(has(comment, "w:bidi")).toBe(true);
    const tab = para("e|--0--|");
    expect(tab.innerHTML ?? "").not.toContain("w:bidi");
    expect(all(tab, "w:rFonts")[0]?.getAttribute("w:ascii")).toBe(
      "Courier New",
    );
    expect(has(tab, "w:rtl")).toBe(false);
  });

  it("maps raw lines by first strong direction and empty lines to an empty paragraph", async () => {
    const doc = docOf("T", [inlineEntry("{title: Raw}\n")]);
    const song = doc.songs[0] as ExportDocument["songs"][number];
    song.lines = [
      { kind: "raw", text: "{שבור" },
      { kind: "raw", text: "{broken" },
      { kind: "empty" },
    ];
    const d = await documentXml(doc);
    const para = (needle: string): Element =>
      all(d, "w:p").find((p) => text(p).includes(needle)) as Element;
    const rtlRaw = para("שבור");
    expect(has(rtlRaw, "w:bidi")).toBe(true);
    expect(rtlRuns(rtlRaw)).toHaveLength(1);
    const ltrRaw = para("broken");
    expect(has(ltrRaw, "w:bidi")).toBe(false);
    expect(has(ltrRaw, "w:rtl")).toBe(false);
    const paras = all(d, "w:p");
    const last = paras[paras.length - 1] as Element;
    expect(text(last)).toBe("");
    expect(runsOf(last)).toHaveLength(0);
    expect(paras.indexOf(last)).toBe(paras.indexOf(ltrRaw) + 1);
  });
});

describe("buildDocx chord direction (04b)", () => {
  const chordCellsOf = (tbl: Element): Element[] =>
    cellsOf(rows(tbl)[0] as Element);
  const expectChordCell = (tc: Element, rtl: boolean, chord?: string): void => {
    if (chord !== undefined) expect(text(tc)).toBe(chord);
    expect(has(tc, "w:bidi")).toBe(false);
    expect(rtlRuns(tc)).toHaveLength(0);
    if (rtl) {
      expect(paraJc(tc)).toBe("right");
      expect(sizeOf(tc, "left")).toBe(100);
      expect(sizeOf(tc, "right")).toBe(0);
    } else {
      expect(paraJc(tc)).not.toBe("right");
      expect(sizeOf(tc, "left")).toBe(0);
      expect(sizeOf(tc, "right")).toBe(100);
    }
  };

  it("keeps F# in the second mixed_he_en line as plain ltr chord text in an rtl cell", async () => {
    const d = await documentXml(
      docOf("T", [entry("mixed_he_en", { transpose: 2 })]),
    );
    const tbl = tableWith(d, "רוקדת");
    expect(has(tbl, "w:bidiVisual")).toBe(true);
    const cells = chordCellsOf(tbl);
    const fs = cells.filter((tc) => text(tc) === "F#");
    expect(fs).toHaveLength(1);
    for (const tc of cells) expectChordCell(tc, true);
    expect(
      all(tbl, "w:t").some((t) =>
        /[\u200E\u200F\u2066-\u2069]/.test(t.textContent ?? ""),
      ),
    ).toBe(false);
  });

  it("gives ltr cells of the mixed line left alignment and a right margin, rtl cells the mirror", async () => {
    const d = await documentXml(
      docOf("T", [entry("mixed_he_en", { transpose: 2 })]),
    );
    const tbl = tableWith(d, "oll");
    const [chordRow, lyricRow] = rows(tbl) as [Element, Element];
    const lyrics = cellsOf(lyricRow).map(text);
    expect(lyrics).toEqual(["אנחנו שרים ", "oll", "rock and r", " עד הבוקר"]);
    cellsOf(chordRow).forEach((tc, i) => {
      expectChordCell(tc, !["oll", "rock and r"].includes(lyrics[i] as string));
    });
  });

  it("aligns and pads an rtl cell inside an ltr line like any rtl cell", async () => {
    const d = await documentXml(
      docOf("T", [inlineEntry("{title: X}\n\n[C]hello [Am]שלום[G]world\n")]),
      false,
      LTR_META,
    );
    const tbl = all(d, "w:tbl")[0] as Element;
    expect(all(d, "w:bidiVisual")).toHaveLength(0);
    const [chordRow, lyricRow] = rows(tbl) as [Element, Element];
    const lyrics = cellsOf(lyricRow).map(text);
    expect(lyrics).toEqual(["hello ", "שלום", "world"]);
    cellsOf(chordRow).forEach((tc, i) => {
      expectChordCell(tc, i === 1);
    });
  });

  it("keeps English chord paragraphs unbidi, unaligned, with a right margin", async () => {
    const d = await documentXml(
      docOf("T", [entry("en_plain")]),
      false,
      LTR_META,
    );
    const tables = all(d, "w:tbl");
    expect(tables.length).toBeGreaterThan(0);
    for (const tbl of tables) {
      for (const tc of chordCellsOf(tbl)) expectChordCell(tc, false);
    }
  });

  it("applies the same rules to chord_only_line cells (rtl)", async () => {
    const d = await documentXml(docOf("T", [entry("chord_only_line")]));
    const tbl = all(d, "w:tbl").filter(
      (t) => rows(t).length === 1,
    )[0] as Element;
    const cells = chordCellsOf(tbl);
    expect(cells.map(text)).toEqual(["Am", "G", "F", "E"]);
    for (const tc of cells) expectChordCell(tc, true);
  });
});
