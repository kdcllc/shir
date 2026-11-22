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
const FENCE = /^\s*(```|~~~)/;
const DELIMITER = /^\s*\{\s*(?:new_song|ns)\s*\}\s*$/i;

function fencedChunks(lines: readonly string[]): string[][] | null {
  const chunks: string[][] = [];
  let current: string[] | null = null;
  let fence = "";
  for (const line of lines) {
    const m = FENCE.exec(line);
    if (current === null) {
      if (m !== null) {
        current = [];
        fence = m[1] ?? "";
      }
    } else if (m !== null && m[1] === fence) {
      chunks.push(current);
      current = null;
    } else {
      current.push(line);
    }
  }
  if (current !== null) chunks.push(current);
  return chunks.length > 0 ? chunks : null;
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
  const chunks = fencedChunks(lines) ?? [lines];
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
