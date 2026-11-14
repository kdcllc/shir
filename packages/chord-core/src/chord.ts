/** A note name: a letter A-G plus an optional `#` or `b`. */
export type NoteName = string;

/** A chord split into root, verbatim suffix and optional bass note. */
export interface ParsedChord {
  root: NoteName;
  suffix: string;
  bass?: NoteName;
}

/** Accidental spelling to use for tie or no-key cases. */
export type SpellingPreference = "sharp" | "flat";

/** Parse chord text per the grammar in `docs/CHORDPRO.md`; `null` when unparseable. */
export function parseChord(text: string): ParsedChord | null {
  void text;
  throw new Error("not implemented: parseChord");
}

/** Format a parsed chord back to text. */
export function formatChord(chord: ParsedChord): string {
  void chord;
  throw new Error("not implemented: formatChord");
}

/** Pitch class 0-11 of a note name (C = 0); `null` when not a note. */
export function noteToPitchClass(note: NoteName): number | null {
  void note;
  throw new Error("not implemented: noteToPitchClass");
}

/** Transpose a key (`Am`, `F#`) by semitones; `null` when it is not a key. */
export function transposeKey(
  key: string,
  semitones: number,
  prefer?: SpellingPreference,
): string | null {
  void key;
  void semitones;
  void prefer;
  throw new Error("not implemented: transposeKey");
}

/** Options for {@link transposeChord}. */
export interface TransposeOptions {
  /** Source key used to pick the spelling style (default: none). */
  key?: string;
  /** Spelling for tie or no-key cases (default: see `docs/CHORDPRO.md`). */
  prefer?: SpellingPreference;
}

/**
 * Transpose one chord by semitones. An unparseable chord is returned verbatim
 * with `ok: false`.
 */
export function transposeChord(
  chord: string,
  semitones: number,
  options?: TransposeOptions,
): { chord: string; ok: boolean } {
  void chord;
  void semitones;
  void options;
  throw new Error("not implemented: transposeChord");
}
