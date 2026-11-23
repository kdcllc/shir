import type { Diagnostic } from "./model";
import { parseSong } from "./song";

export interface AiReplySong {
  chordpro: string;
  title?: string;
  diagnostics: Diagnostic[];
}
export interface AiReplyResult {
  songs: AiReplySong[];
  truncated: boolean;
}

const MAX_SONGS = 500;
const OPEN_FENCE = /^\s*(`{3,}|~{3,})/;
const CLOSE_FENCE = /^\s*(`{3,}|~{3,})\s*$/;
const DELIMITER = /^\s*\{\s*(?:new_song|ns)\s*\}\s*$/i;
const DIRECTIVE_LINE = /^\s*\{[^{}]+\}\s*$/;
const INLINE_CHORD = /\[[^\]\s]+\]/;

interface Fenced {
  chunks: string[][];
  /** True when the last opened fence never closed. */
  unclosed: boolean;
  /** Lines before the first opening fence. */
  before: string[];
}

/** CommonMark fences: a closer repeats the opener's character, at least as long, with nothing after it. */
function fencedChunks(lines: readonly string[]): Fenced | null {
  const chunks: string[][] = [];
  const before: string[] = [];
  let current: string[] | null = null;
  let char = "";
  let length = 0;
  for (const line of lines) {
    if (current === null) {
      const m = OPEN_FENCE.exec(line);
      if (m === null) {
        if (chunks.length === 0) before.push(line);
        continue;
      }
      const run = m[1] ?? "";
      current = [];
      char = run.charAt(0);
      length = run.length;
      continue;
    }
    const close = CLOSE_FENCE.exec(line);
    const run = close?.[1] ?? "";
    if (close !== null && run.charAt(0) === char && run.length >= length) {
      chunks.push(current);
      current = null;
    } else {
      current.push(line);
    }
  }
  if (current !== null) chunks.push(current);
  return chunks.length > 0
    ? { chunks, unclosed: current !== null, before }
    : null;
}

function looksLikeChordPro(lines: readonly string[]): boolean {
  return lines.some(
    (line) => DIRECTIVE_LINE.test(line) || INLINE_CHORD.test(line),
  );
}

function pieces(chunk: readonly string[]): string[][] {
  const out: string[][] = [[]];
  for (const line of chunk) {
    if (DELIMITER.test(line)) out.push([]);
    else out[out.length - 1]?.push(line);
  }
  return out;
}

function trimBlank(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? "").trim() === "") start += 1;
  while (end > start && (lines[end - 1] ?? "").trim() === "") end -= 1;
  return lines.slice(start, end);
}

/**
 * Split a pasted AI reply into songs: fenced blocks when present, songs
 * separated by `{new_song}` / `{ns}` lines. Never throws.
 */
export function parseAiReply(reply: string): AiReplyResult {
  const normalized = (reply.startsWith("\uFEFF") ? reply.slice(1) : reply)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const fenced = fencedChunks(lines);
  const hasContent =
    fenced !== null &&
    fenced.chunks.some((chunk) =>
      pieces(chunk).some((piece) => trimBlank(piece).length > 0),
    );
  const useFenced =
    fenced !== null &&
    hasContent &&
    !(fenced.unclosed && looksLikeChordPro(fenced.before));
  const chunks: string[][] = useFenced
    ? fenced.chunks
    : [lines.filter((line) => !OPEN_FENCE.test(line))];
  const songs: AiReplySong[] = [];
  let truncated = false;
  for (const chunk of chunks) {
    for (const piece of pieces(chunk)) {
      const kept = trimBlank(piece);
      if (kept.length === 0) continue;
      if (songs.length >= MAX_SONGS) {
        truncated = true;
        continue;
      }
      const chordpro = `${kept.join("\n")}\n`;
      const parsed = parseSong(chordpro);
      const song: AiReplySong = {
        chordpro,
        diagnostics: parsed.diagnostics,
      };
      if (parsed.song.title !== undefined) song.title = parsed.song.title;
      songs.push(song);
    }
  }
  return { songs, truncated };
}
