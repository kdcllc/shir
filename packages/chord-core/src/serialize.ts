import type { SongModel } from "./model";

/** Serialize a song model to canonical ChordPro text (`docs/CHORDPRO.md`). */
export function serializeSong(song: SongModel): string {
  void song;
  throw new Error("not implemented: serializeSong");
}
