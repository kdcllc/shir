import type { SpellingPreference } from "./chord";
import type { Diagnostic, SongModel } from "./model";

/** A transformed song plus diagnostics (e.g. `unknown-chord`). */
export interface TransformResult {
  song: SongModel;
  diagnostics: Diagnostic[];
}

/** Transpose a song model (a new model; the input is never mutated). */
export function transposeSong(
  song: SongModel,
  semitones: number,
  options?: { prefer?: SpellingPreference },
): TransformResult {
  void song;
  void semitones;
  void options;
  throw new Error("not implemented: transposeSong");
}

/** Options for {@link viewSong}. */
export interface ViewOptions {
  /** Semitones to transpose (default 0). */
  transpose?: number;
  /** Capo fret 0-24 (default `song.capo ?? 0`). */
  capo?: number;
  /** Spelling for tie or no-key cases (default: see `docs/CHORDPRO.md`). */
  prefer?: SpellingPreference;
}

/** A view of a song: transposed chords shown as capo shapes. */
export interface ViewResult extends TransformResult {
  capo: number;
  soundingKey?: string;
  shapeKey?: string;
}

/** Build the view-only (non-persisted) song for a transpose and capo. */
export function viewSong(song: SongModel, options?: ViewOptions): ViewResult {
  void song;
  void options;
  throw new Error("not implemented: viewSong");
}
