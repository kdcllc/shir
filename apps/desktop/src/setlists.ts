import { parseSong, splitGraphemes } from "chord-core";
import type { ExportEntry } from "chord-core";
import type { Setlist } from "./storage";

/** Maximum setlist name length in characters (the storage rule). */
const MAX_NAME = 200;

/** Returns a new order with `itemId` moved by `delta` places; a move past either end changes nothing. */
export function moveItem(
  ids: readonly string[],
  itemId: string,
  delta: number,
): string[] {
  const next = [...ids];
  const from = next.indexOf(itemId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= next.length || delta === 0) return next;
  next.splice(from, 1);
  next.splice(to, 0, itemId);
  return next;
}

/**
 * The name of a duplicate: `name`, a space and `suffix`. The name is cut (on a grapheme
 * boundary) so the result never exceeds 200 characters; the suffix is always kept.
 */
export function duplicateName(name: string, suffix: string): string {
  const tail = ` ${suffix}`;
  const budget = Math.max(0, MAX_NAME - [...tail].length);
  let kept = "";
  let used = 0;
  for (const grapheme of splitGraphemes(name)) {
    const size = [...grapheme].length;
    if (used + size > budget) break;
    kept += grapheme;
    used += size;
  }
  return `${kept}${tail}`;
}

/** The part of a stored song the export reads. */
export interface ExportSource {
  chordpro: string;
}

/**
 * Parses each entry's song and pairs it with the entry's transpose and capo
 * (`capo ?? song capo ?? 0`). Throws when a song is missing from `songsById`.
 */
export function entriesToExport(
  setlist: Pick<Setlist, "items">,
  songsById: ReadonlyMap<string, ExportSource>,
): ExportEntry[] {
  return setlist.items.map((item) => {
    const stored = songsById.get(item.songId);
    if (stored === undefined) throw new Error(`song ${item.songId} not loaded`);
    const { song } = parseSong(stored.chordpro);
    return songToExport(song, item.transpose, item.capo ?? song.capo ?? 0);
  });
}

/** One song at the given transpose and capo, as an export entry. */
export function songToExport(
  song: ExportEntry["song"],
  transpose: number,
  capo: number,
): ExportEntry {
  return { song, transpose, capo };
}
