import {
  directionalCells,
  firstStrongDirection,
  type ExportCell,
  type ExportDocument,
  type ExportLine,
  type ExportSong,
  type TextDirection,
} from "chord-core";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { estimateColumnWidths, fitColumnWidths } from "./columnWidths";
import type { ExportLabels, ExportMeta } from "./types";

type Child = Paragraph | Table;

const FONT = { ascii: "Arial", hAnsi: "Arial", cs: "Arial" } as const;
const MONO = { ascii: "Courier New", hAnsi: "Courier New", cs: "Courier New" };
/** 2 cm in twips. */
const PAGE_MARGIN = 1134;
/** Chord cells keep at least 0.15 cm (85 twips) at their inline end; 100 twips = 0.176 cm. */
const CHORD_END_MARGIN = 100;

/** Printable width: A4 (11906) minus 2 x 2 cm margins. */
const PRINTABLE_WIDTH = 11906 - 2 * PAGE_MARGIN;

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "auto" } as const;
const NO_BORDERS = {
  top: NO_BORDER,
  bottom: NO_BORDER,
  left: NO_BORDER,
  right: NO_BORDER,
  insideHorizontal: NO_BORDER,
  insideVertical: NO_BORDER,
} as const;

const isRtl = (dir: TextDirection): boolean => dir === "rtl";

/**
 * Chord cell: the end margin sits on the cell's visual end (physical `left` in an rtl cell,
 * `right` in an ltr cell). The chord paragraph is never `w:bidi` (a trailing neutral such as `#`
 * would take the paragraph's rtl direction and read "#F"); it is aligned to the visual right in an
 * rtl cell so the chord sits at the visual start of its syllable. Accepted limitations: Word's
 * reading of `w:tcMar` left/right inside a `w:bidiVisual` table is unverified (LibreOffice reads
 * physical sides, which this targets); in an ltr line an rtl chorded cell directly followed by an
 * ltr chorded cell meets it at the shared boundary, each chord at its own syllable start.
 */
function chordCell(chord: string | undefined, rtl: boolean): TableCell {
  return new TableCell({
    margins: rtl
      ? { left: CHORD_END_MARGIN, right: 0 }
      : { left: 0, right: CHORD_END_MARGIN },
    children: [
      new Paragraph({
        children: chord === undefined ? [] : [run(chord, { bold: true })],
        ...(rtl ? { alignment: AlignmentType.RIGHT } : {}),
      }),
    ],
  });
}

function run(
  text: string,
  o: { rtl?: boolean; bold?: boolean; italics?: boolean; mono?: boolean } = {},
): TextRun {
  return new TextRun({
    text,
    font: o.mono ? MONO : FONT,
    ...(o.bold ? { bold: true } : {}),
    ...(o.italics ? { italics: true } : {}),
    ...(o.rtl ? { rightToLeft: true } : {}),
  });
}

function para(
  children: TextRun[],
  o: { rtl?: boolean; pageBreakBefore?: boolean; heading?: boolean } = {},
): Paragraph {
  return new Paragraph({
    children,
    ...(o.rtl ? { bidirectional: true } : {}),
    ...(o.pageBreakBefore ? { pageBreakBefore: true } : {}),
    ...(o.heading ? { heading: HeadingLevel.HEADING_2 } : {}),
  });
}

/** Separates two tables; without a paragraph between them Word merges them into one table. */
function spacer(): Paragraph {
  return new Paragraph({ run: { size: 4 }, spacing: { after: 40 } });
}

/**
 * `cells` are in emitted column order. Column widths come from the content (`w:tblGrid`), scaled
 * down to the printable width; a line wider than the page still does not wrap.
 */
function table(
  rows: TableRow[],
  rtl: boolean,
  cells: readonly { chord?: string; text: string }[],
): Table {
  return new Table({
    rows,
    columnWidths: fitColumnWidths(estimateColumnWidths(cells), PRINTABLE_WIDTH),
    width: { size: 0, type: WidthType.AUTO },
    borders: NO_BORDERS,
    ...(rtl
      ? { visuallyRightToLeft: true, alignment: AlignmentType.RIGHT }
      : {}),
  });
}

/**
 * Column order of a lyric table (B3). Characters are never reordered or reversed: only whole
 * single-direction cells are. Every maximal group of consecutive cells whose direction is opposite
 * to the line direction is emitted in reverse logical order, so the group reads in its own
 * direction inside the table laid out in the line direction.
 */
function columnOrder(
  cells: readonly ExportCell[],
  lineDir: TextDirection,
): ExportCell[] {
  const out: ExportCell[] = [];
  let i = 0;
  while (i < cells.length) {
    const cell = cells[i] as ExportCell;
    if (cell.direction === lineDir) {
      out.push(cell);
      i++;
      continue;
    }
    let j = i;
    while (j < cells.length && (cells[j] as ExportCell).direction !== lineDir) {
      j++;
    }
    out.push(...cells.slice(i, j).reverse());
    i = j;
  }
  return out;
}

/**
 * A lyric line with chords: a two-row borderless table (chords above lyric), one column per
 * single-direction cell. Accepted limitation: a very long line stays one table row and does not
 * wrap across rows the way the screen view does.
 * Chord cells keep an end margin on their visual end side (see `chordCell`);
 * lyric cells have zero side margins so a cell boundary inside a word shows no gap.
 */
function lyricTable(
  line: Extract<ExportLine, { kind: "lyric" }>,
  cells: ExportCell[],
): Table {
  const ordered = columnOrder(cells, line.direction);
  const chordRow = new TableRow({
    children: ordered.map((cell) =>
      chordCell(cell.chord, isRtl(cell.direction)),
    ),
  });
  const lyricRow = new TableRow({
    children: ordered.map(
      (cell) =>
        new TableCell({
          margins: { left: 0, right: 0 },
          children: [
            para(
              cell.text === ""
                ? []
                : [run(cell.text, { rtl: isRtl(cell.direction) })],
              { rtl: isRtl(cell.direction) },
            ),
          ],
        }),
    ),
  });
  return table([chordRow, lyricRow], isRtl(line.direction), ordered);
}

function chordsTable(line: Extract<ExportLine, { kind: "chords" }>): Table {
  const rtl = isRtl(line.direction);
  const row = new TableRow({
    children: line.chords.map((chord) => chordCell(chord, rtl)),
  });
  return table(
    [row],
    isRtl(line.direction),
    line.chords.map((chord) => ({ chord, text: "" })),
  );
}

function lineChildren(line: ExportLine): Child[] {
  switch (line.kind) {
    case "lyric": {
      const cells = directionalCells(line);
      if (!cells.some((c) => c.chord !== undefined)) {
        return [
          para(
            cells.map((c) => run(c.text, { rtl: isRtl(c.direction) })),
            { rtl: isRtl(line.direction) },
          ),
        ];
      }
      return [lyricTable(line, cells), spacer()];
    }
    case "chords":
      return [chordsTable(line), spacer()];
    case "section":
      return [
        para([run(line.label, { bold: true, rtl: isRtl(line.direction) })], {
          rtl: isRtl(line.direction),
        }),
      ];
    case "comment":
      return [
        para([run(line.text, { italics: true, rtl: isRtl(line.direction) })], {
          rtl: isRtl(line.direction),
        }),
      ];
    case "tab":
      return [para([run(line.text, { mono: true })])];
    case "raw": {
      const rtl = firstStrongDirection(line.text) === "rtl";
      return [para([run(line.text, { rtl })], { rtl })];
    }
    case "empty":
      return [new Paragraph({})];
    default: {
      const unreachable: never = line;
      return unreachable;
    }
  }
}

function factParts(song: ExportSong, labels: ExportLabels): string[] {
  const parts: string[] = [];
  if (song.artist !== undefined) parts.push(song.artist);
  if (song.soundingKey !== undefined) {
    parts.push(`${labels.key}: ${song.soundingKey}`);
  }
  if (song.capo > 0) parts.push(`${labels.capo}: ${song.capo}`);
  return parts;
}

/** Runs for text pieces joined by " · ", each piece carrying its own direction. */
function joinedRuns(parts: string[]): TextRun[] {
  const runs: TextRun[] = [];
  parts.forEach((part, i) => {
    if (i > 0) runs.push(run(" · "));
    runs.push(run(part, { rtl: firstStrongDirection(part) === "rtl" }));
  });
  return runs;
}

function coverChildren(
  doc: ExportDocument,
  labels: ExportLabels,
  meta: ExportMeta,
): Child[] {
  const rtl = meta.dir === "rtl";
  const titleRtl = (firstStrongDirection(doc.title) ?? meta.dir) === "rtl";
  const children: Child[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      ...(titleRtl ? { bidirectional: true } : {}),
      children: [run(doc.title, { bold: true, rtl: titleRtl })],
    }),
    para([run(`${labels.date}: ${meta.dateText}`, { rtl })], { rtl }),
    para([run(labels.songs, { bold: true, rtl })], { rtl }),
  ];
  doc.songs.forEach((song, i) => {
    const parts = [song.title, ...factParts(song, labels)];
    children.push(
      para([run(`${i + 1}. `, { rtl }), ...joinedRuns(parts)], { rtl }),
    );
  });
  return children;
}

function songChildren(
  song: ExportSong,
  labels: ExportLabels,
  pageBreakBefore: boolean,
): Child[] {
  const rtl = isRtl(song.direction);
  const children: Child[] = [
    para(
      [
        run(song.title, {
          bold: true,
          rtl: firstStrongDirection(song.title) === "rtl",
        }),
      ],
      {
        rtl: firstStrongDirection(song.title) === "rtl",
        pageBreakBefore,
        heading: true,
      },
    ),
  ];
  const facts = factParts(song, labels);
  if (facts.length > 0) children.push(para(joinedRuns(facts), { rtl }));
  for (const line of song.lines) children.push(...lineChildren(line));
  return children;
}

/** Builds the Word document for an export; browser-safe (no Node `Buffer`). */
export async function buildDocx(
  doc: ExportDocument,
  opts: { cover: boolean; labels: ExportLabels; meta: ExportMeta },
): Promise<Uint8Array> {
  const children: Child[] = [];
  if (opts.cover) children.push(...coverChildren(doc, opts.labels, opts.meta));
  doc.songs.forEach((song, i) => {
    children.push(...songChildren(song, opts.labels, opts.cover || i > 0));
  });
  const file = new Document({
    styles: { default: { document: { run: { font: FONT, size: 24 } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: {
              top: PAGE_MARGIN,
              bottom: PAGE_MARGIN,
              left: PAGE_MARGIN,
              right: PAGE_MARGIN,
            },
          },
        },
        children,
      },
    ],
  });
  const blob = await Packer.toBlob(file);
  return new Uint8Array(await blob.arrayBuffer());
}
