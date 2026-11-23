import { parseChord } from "./chord";
import { firstStrongDirection } from "./direction";
import { splitGraphemes } from "./graphemes";
import type { RtlColumns } from "./import";

// These types mirror the generated IPC bindings structurally; chord-core
// never imports from the desktop app.
export type DocumentFormat = "docx" | "odt" | "rtf" | "pdf";
export type DocumentBlock =
  { kind: "paragraph"; text: string } | { kind: "table"; rows: string[][] };
export interface DocumentInput {
  format: DocumentFormat;
  blocks: readonly DocumentBlock[];
}
export interface DocumentTextResult {
  text: string;
  rtlColumns: RtlColumns;
}

const TAB_STOP = 8;

function tokensOf(text: string): string[] {
  return text.split(/\s+/u).filter((t) => t !== "");
}

function isBlank(text: string): boolean {
  return text.trim() === "";
}

/** True when every whitespace-separated token of the text is a chord. */
function allChords(text: string): boolean {
  const tokens = tokensOf(text);
  return tokens.length > 0 && tokens.every((t) => parseChord(t) !== null);
}

function isChordRow(row: readonly string[]): boolean {
  const filled = row.filter((c) => !isBlank(c));
  return filled.length > 0 && filled.every((c) => allChords(c));
}

function isBlankRow(row: readonly string[]): boolean {
  return row.every(isBlank);
}

function joinPieces(pieces: readonly string[]): string {
  let out = "";
  for (const piece of pieces) {
    if (out === "") {
      out = piece;
    } else if (out.endsWith("-")) {
      out = out.slice(0, -1) + piece;
    } else if (/\s$/u.test(out) || /^\s/u.test(piece)) {
      out += piece;
    } else {
      out += ` ${piece}`;
    }
  }
  return out;
}

function mergeRow(
  chordRow: readonly string[],
  lyricRow: readonly string[] | null,
): string {
  const width = Math.max(chordRow.length, lyricRow?.length ?? 0);
  const pieces: string[] = [];
  for (let i = 0; i < width; i++) {
    const chords = tokensOf(chordRow[i] ?? "")
      .map((c) => `[${c}]`)
      .join("");
    const lyric = (lyricRow?.[i] ?? "").replace(/\n/g, " ");
    const piece = chords + lyric;
    if (chords === "" && isBlank(lyric)) continue;
    pieces.push(piece);
  }
  return joinPieces(pieces);
}

function tableLines(rows: readonly (readonly string[])[]): string[] {
  const lines: string[] = [];
  for (let k = 0; k < rows.length; k++) {
    const row = (rows[k] ?? []).map((c) => c.replace(/\r/g, ""));
    if (isBlankRow(row)) {
      lines.push("");
    } else if (isChordRow(row)) {
      const next = (rows[k + 1] ?? null)?.map((c) => c.replace(/\r/g, ""));
      if (
        next !== undefined &&
        next !== null &&
        !isBlankRow(next) &&
        !isChordRow(next)
      ) {
        lines.push(mergeRow(row, next));
        k += 1;
      } else {
        lines.push(
          tokensOf(row.join(" "))
            .map((c) => `[${c}]`)
            .join(" "),
        );
      }
    } else {
      lines.push(
        row
          .map((c) => c.replace(/\n/g, " ").trim())
          .filter((c) => c !== "")
          .join(" "),
      );
    }
  }
  return lines;
}

function expandTabs(line: string): string {
  if (!line.includes("\t")) return line;
  let out = "";
  let col = 0;
  for (const ch of line) {
    if (ch === "\t") {
      const pad = TAB_STOP - (col % TAB_STOP);
      out += " ".repeat(pad);
      col += pad;
    } else {
      out += ch;
      col += 1;
    }
  }
  return out;
}

function isChordLine(line: string): boolean {
  return allChords(line);
}

/**
 * Right-edge alignment of chord lines above Hebrew lyrics (B9): a chord line
 * is rewritten in its displayed form and left-padded so that, mirrored by the
 * importer, each chord lands on the syllable it sits over.
 */
function alignRtlChordLines(lines: string[]): string[] {
  const out = [...lines];
  for (let k = 0; k + 1 < lines.length; k++) {
    const line = lines[k] ?? "";
    const lyric = lines[k + 1] ?? "";
    if (!isChordLine(line) || firstStrongDirection(lyric) !== "rtl") continue;
    const shown = expandTabs(line).trimEnd();
    const body = shown.trimStart();
    const lead = shown.slice(0, shown.length - body.length);
    const rewritten = body + lead;
    const pad = Math.max(
      0,
      splitGraphemes(lyric).length - splitGraphemes(rewritten).length,
    );
    out[k] = " ".repeat(pad) + rewritten;
  }
  return out;
}

/**
 * Turn extracted document blocks into plain text for `importText`: tables of
 * chord rows over lyric rows become inline ChordPro, and chord lines above
 * Hebrew lyrics are aligned to the right edge (docx, odt, rtf). Never throws.
 */
export function documentToText(doc: DocumentInput): DocumentTextResult {
  const lines: string[] = [];
  for (const block of doc.blocks) {
    if (block.kind === "paragraph") {
      lines.push(...block.text.replace(/\r/g, "").split("\n"));
    } else {
      lines.push(...tableLines(block.rows));
    }
  }
  const aligned = doc.format === "pdf" ? lines : alignRtlChordLines(lines);
  const joined = aligned.join("\n").replace(/\n+$/, "");
  const text = joined === "" ? "" : `${joined}\n`;
  return { text, rtlColumns: "mirror" };
}
