import { parseChord } from "./chord";
import { firstStrongDirection } from "./direction";
import { splitGraphemes } from "./graphemes";

export type ImportFormat = "chordpro" | "chords-over-lyrics";
export type RtlColumns = "mirror" | "logical";
export interface ImportOptions {
  rtlColumns?: RtlColumns;
}
export type ImportWarningCode = "chord-past-end" | "no-chords";
export interface ImportWarning {
  /** 1-based source line. */
  line: number;
  code: ImportWarningCode;
  message: string;
}
export interface ImportResult {
  chordpro: string;
  format: ImportFormat;
  warnings: ImportWarning[];
  /**
   * True iff an R5 merge placed chords over an RTL lyric line. Always false
   * for format "chordpro".
   */
  hasRtlChords: boolean;
}

const DIRECTIVE_LINE = /^\s*\{[^}]*\}\s*$/;
const LITERAL_START =
  /^\s*\{\s*(start_of_(?:tab|grid|abc|ly|textblock|svg)|sot|sog)(?![A-Za-z0-9_])[^}]*\}\s*$/i;
const LITERAL_END =
  /^\{\s*(end_of_(?:tab|grid|abc|ly|textblock|svg)|eot|eog)\s*\}$/i;
const INLINE_BRACKET = /\[([^[\]]*)\]/g;
const TAB_STOP = 8;

/** Canonical literal-section kind of a start/end tag name (Map: user text keys). */
const KIND_ALIASES: ReadonlyMap<string, string> = new Map([
  ["sot", "tab"],
  ["eot", "tab"],
  ["sog", "grid"],
  ["eog", "grid"],
]);

function literalKind(tagName: string): string {
  const name = tagName.toLowerCase();
  const alias = KIND_ALIASES.get(name);
  if (alias !== undefined) return alias;
  return name.replace(/^(?:start|end)_of_/, "");
}

function hasInlineChord(line: string): boolean {
  for (const m of line.matchAll(INLINE_BRACKET)) {
    if (parseChord(m[1] ?? "") !== null) return true;
  }
  return false;
}

function isPassthroughLine(line: string): boolean {
  return (
    line.trim() === "" ||
    line.startsWith("#") ||
    DIRECTIVE_LINE.test(line) ||
    hasInlineChord(line)
  );
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

interface ChordToken {
  text: string;
  /** Column span [start, end) in code points of the tab-expanded line. */
  start: number;
  end: number;
}

/** Tokens of a chord line, or null when some token is not a chord (R3). */
function chordTokens(line: string): ChordToken[] | null {
  const chars = Array.from(expandTabs(line));
  const tokens: ChordToken[] = [];
  let i = 0;
  while (i < chars.length) {
    if (/\s/u.test(chars[i] ?? "")) {
      i += 1;
      continue;
    }
    const start = i;
    while (i < chars.length && !/\s/u.test(chars[i] ?? "")) i += 1;
    const text = chars.slice(start, i).join("");
    if (parseChord(text) === null) return null;
    tokens.push({ text, start, end: i });
  }
  return tokens.length === 0 ? null : tokens;
}

type BidiType = "L" | "R" | "EN" | "N";

// Simplified UAX #9 limits (documented gaps): W4/W5 number separators and
// terminators (`1,000`, `5%` inside RTL text) are plain N here, so they
// resolve by N1/N2 rather than joining the digit run. RTL_SCRIPT_GRAPHEME
// covers the whole Hebrew/Arabic script (RTL script graphemes, including
// maqaf and geresh) and therefore also Arabic-Indic digits, which are
// classified R here instead of AN.
const RTL_SCRIPT_GRAPHEME = /^[\p{Script=Hebrew}\p{Script=Arabic}]$/u;
const LETTER = /^\p{L}$/u;
const DIGIT = /^\p{Nd}$/u;

function classify(grapheme: string): BidiType {
  const cp = String.fromCodePoint(grapheme.codePointAt(0) ?? 0x20);
  if (cp === "\u200F" || cp === "\u061C") return "R";
  if (cp === "\u200E") return "L";
  if (RTL_SCRIPT_GRAPHEME.test(cp)) return "R";
  if (LETTER.test(cp)) return "L";
  if (DIGIT.test(cp)) return "EN";
  return "N";
}

interface VisualMap {
  /** vis[c] = logical index of the grapheme shown at visual column c. */
  vis: number[];
  levels: number[];
}

/** Bidi-run visual map of an LTR paragraph (R6, mirror mode). */
function visualMap(g: readonly string[]): VisualMap {
  const n = g.length;
  const raw = g.map(classify);

  // W7: EN after L (or with no strong before) becomes L.
  const types: BidiType[] = [...raw];
  let lastStrong: "L" | "R" | null = null;
  for (let k = 0; k < n; k++) {
    const t = raw[k];
    if (t === "L" || t === "R") lastStrong = t;
    else if (t === "EN" && (lastStrong === null || lastStrong === "L")) {
      types[k] = "L";
    }
  }

  // N1/N2: neutral runs take the surrounding type when both sides agree
  // (EN counts as R), else the paragraph direction L.
  const asStrong = (t: BidiType): "L" | "R" => (t === "L" ? "L" : "R");
  for (let k = 0; k < n;) {
    if (types[k] !== "N") {
      k += 1;
      continue;
    }
    let end = k;
    while (end < n && types[end] === "N") end += 1;
    const before = k === 0 ? "L" : asStrong(types[k - 1] ?? "L");
    const after = end === n ? "L" : asStrong(types[end] ?? "L");
    const resolved: BidiType = before === after ? before : "L";
    for (let j = k; j < end; j++) types[j] = resolved;
    k = end;
  }

  // I1 levels, then L2 reordering.
  const levels: number[] = types.map((t) =>
    t === "L" ? 0 : t === "R" ? 1 : 2,
  );
  const vis = Array.from({ length: n }, (_, k) => k);
  const maxLevel = levels.reduce((a, b) => Math.max(a, b), 0);
  for (let lvl = maxLevel; lvl >= 1; lvl--) {
    for (let c = 0; c < n;) {
      if ((levels[vis[c] ?? 0] ?? 0) < lvl) {
        c += 1;
        continue;
      }
      let end = c;
      while (end < n && (levels[vis[end] ?? 0] ?? 0) >= lvl) end += 1;
      const run = vis.slice(c, end).reverse();
      for (let j = 0; j < run.length; j++) vis[c + j] = run[j] ?? 0;
      c = end;
    }
  }
  return { vis, levels };
}

interface Placement {
  index: number;
  order: number;
  text: string;
}

function mergeLine(
  tokens: ChordToken[],
  lyric: string,
  mirror: boolean,
): { text: string; pastEnd: boolean } {
  const g = splitGraphemes(lyric);
  const n = g.length;
  const rtl = firstStrongDirection(lyric) === "rtl";
  const map = rtl && mirror ? visualMap(g) : null;
  let pastEnd = false;

  const placements: Placement[] = tokens.map((tok, order) => {
    let i: number;
    if (map !== null) {
      const { vis, levels } = map;
      const levelAt = (c: number): number => levels[vis[c] ?? 0] ?? 0;
      if (tok.start < n && levelAt(tok.start) % 2 === 0) {
        i = vis[tok.start] ?? 0;
      } else if (tok.end - 1 < n) {
        i = vis[tok.end - 1] ?? 0;
      } else {
        pastEnd = true;
        if (n === 0) i = 0;
        else i = levelAt(n - 1) % 2 === 1 ? (vis[n - 1] ?? 0) : n;
      }
    } else {
      i = tok.start;
      if (i > n) {
        i = n;
        pastEnd = true;
      }
    }
    // Forward snap off whitespace (never backward).
    if (i < n && /^\s+$/u.test(g[i] ?? "")) {
      let j = i;
      while (j < n && /^\s+$/u.test(g[j] ?? "")) j += 1;
      i = j;
    }
    return { index: i, order, text: tok.text };
  });

  placements.sort((a, b) => a.index - b.index || a.order - b.order);
  let out = "";
  let p = 0;
  for (let k = 0; k <= n; k++) {
    while (p < placements.length && placements[p]?.index === k) {
      out += `[${placements[p]?.text ?? ""}]`;
      p += 1;
    }
    if (k < n) out += g[k] ?? "";
  }
  return { text: out, pastEnd };
}

/**
 * Import plain text: ChordPro passes through, chords-over-lyrics sheets are
 * converted to inline `[chord]` ChordPro (rules R1-R10 of the g6 goal).
 * Never throws.
 */
export function importText(
  text: string,
  options: ImportOptions = {},
): ImportResult {
  const mirror = (options.rtlColumns ?? "mirror") === "mirror";
  const normalized = (text.startsWith("\uFEFF") ? text.slice(1) : text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const warnings: ImportWarning[] = [];

  // R2: literal sections first, then per-line classification.
  const passthrough: boolean[] = new Array<boolean>(lines.length).fill(false);
  const literal: boolean[] = new Array<boolean>(lines.length).fill(false);
  let openKind: string | null = null;
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k] ?? "";
    if (openKind !== null) {
      literal[k] = true;
      const end = LITERAL_END.exec(line.trim());
      if (end !== null && literalKind(end[1] ?? "") === openKind) {
        openKind = null;
      }
      continue;
    }
    const start = LITERAL_START.exec(line);
    if (start !== null) {
      literal[k] = true;
      openKind = literalKind(start[1] ?? "");
    }
  }
  let anyInline = false;
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k] ?? "";
    if (literal[k] === true) {
      passthrough[k] = true;
    } else if (isPassthroughLine(line)) {
      passthrough[k] = true;
      if (!DIRECTIVE_LINE.test(line) && hasInlineChord(line)) {
        anyInline = true;
      }
    }
  }

  const out: string[] = [];
  let converted = false;
  let hasRtlChords = false;
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k] ?? "";
    if (passthrough[k] === true) {
      out.push(line);
      continue;
    }
    const tokens = chordTokens(line);
    if (tokens === null) {
      out.push(line); // lyric line
      continue;
    }
    converted = true;
    const nextIdx = k + 1;
    const next = lines[nextIdx];
    const mergeable =
      next !== undefined &&
      passthrough[nextIdx] !== true &&
      chordTokens(next) === null;
    if (!mergeable || next === undefined) {
      out.push(tokens.map((t) => `[${t.text}]`).join(" "));
      continue;
    }
    const merged = mergeLine(tokens, next, mirror);
    if (merged.pastEnd) {
      warnings.push({
        line: k + 1,
        code: "chord-past-end",
        message: "A chord lies beyond the end of its lyric line.",
      });
    }
    if (firstStrongDirection(next) === "rtl") hasRtlChords = true;
    out.push(merged.text);
    k += 1; // the lyric line is consumed
  }

  if (!converted) {
    if (!anyInline) {
      warnings.push({
        line: 1,
        code: "no-chords",
        message: "No chords were found in the text.",
      });
    }
    return {
      chordpro: normalized,
      format: "chordpro",
      warnings,
      hasRtlChords: false,
    };
  }
  return {
    chordpro: out.join("\n"),
    format: "chords-over-lyrics",
    warnings,
    hasRtlChords,
  };
}
