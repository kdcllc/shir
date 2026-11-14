import { transposeChord, transposeKey } from "./chord";
import type { SpellingPreference } from "./chord";
import type { Diagnostic, SongModel } from "./model";

/** A transformed song plus diagnostics (e.g. `unknown-chord`). */
export interface TransformResult {
  song: SongModel;
  diagnostics: Diagnostic[];
}

function assertInteger(n: number, what: string): void {
  if (!Number.isInteger(n)) {
    throw new RangeError(`${what} must be an integer, got ${String(n)}`);
  }
}

/**
 * Clone a song and transpose every chord by `semitones`, spelled per `key`.
 * Returns the clone (for the caller to adjust) and the diagnostics.
 */
function mapChords(
  song: SongModel,
  semitones: number,
  key: string | undefined,
  prefer: SpellingPreference | undefined,
): TransformResult {
  const out = structuredClone(song);
  const diagnostics: Diagnostic[] = [];
  const options: { key?: string; prefer?: SpellingPreference } = {};
  if (key !== undefined) options.key = key;
  if (prefer !== undefined) options.prefer = prefer;
  const one = (chord: string, line: number, column: number): string => {
    const r = transposeChord(chord, semitones, options);
    if (!r.ok) {
      diagnostics.push({
        line,
        column,
        code: "unknown-chord",
        message: `Unrecognized chord "${chord}"`,
      });
    }
    return r.chord;
  };
  out.lines.forEach((line, i) => {
    if (line.kind === "lyric") {
      line.chords.forEach((a, j) => {
        a.chord = one(a.chord, i + 1, j + 1);
      });
    } else if (line.kind === "chords") {
      line.chords = line.chords.map((c, j) => one(c, i + 1, j + 1));
    }
  });
  return { song: out, diagnostics };
}

/** Transpose a song model (a new model; the input is never mutated). */
export function transposeSong(
  song: SongModel,
  semitones: number,
  options?: { prefer?: SpellingPreference },
): TransformResult {
  assertInteger(semitones, "semitones");
  const prefer = options?.prefer;
  const result = mapChords(song, semitones, song.key, prefer);
  const out = result.song;
  const rewrite = (value: string): string =>
    transposeKey(value, semitones, prefer) ?? value;
  for (const line of out.lines) {
    if (line.kind === "meta" && line.name === "key") {
      line.value = rewrite(line.value);
    } else if (
      line.kind === "directive" &&
      line.name === "new_key" &&
      line.value !== undefined
    ) {
      line.value = rewrite(line.value);
    }
  }
  if (out.key !== undefined) out.key = rewrite(out.key);
  return result;
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
  const transpose = options?.transpose ?? 0;
  const capo = options?.capo ?? song.capo ?? 0;
  assertInteger(transpose, "transpose");
  assertInteger(capo, "capo");
  if (capo < 0 || capo > 24) {
    throw new RangeError(`capo must be 0-24, got ${String(capo)}`);
  }
  const prefer = options?.prefer;
  const result = mapChords(song, transpose - capo, song.key, prefer);
  const view: ViewResult = { ...result, capo };
  if (song.key !== undefined) {
    const sounding = transposeKey(song.key, transpose, prefer);
    const shape = transposeKey(song.key, transpose - capo, prefer);
    if (sounding !== null) view.soundingKey = sounding;
    if (shape !== null) view.shapeKey = shape;
  }
  return view;
}
