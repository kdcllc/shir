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

const CHORD_RE = /^([A-G])(#|b)?(\S*?)(?:\/([A-G])(#|b)?)?$/;
const NOTE_RE = /^([A-G])(#|b)?$/;
const KEY_RE = /^([A-G](?:#|b)?)(m)?$/;

const NATURAL_PC: Readonly<Record<string, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const SHARP_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;
const FLAT_NAMES = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;
const DEFAULT_NAMES = [
  "C",
  "C#",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;

const MAJOR_KEYS = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;
const MINOR_KEYS = [
  "Cm",
  "C#m",
  "Dm",
  "D#m",
  "Em",
  "Fm",
  "F#m",
  "Gm",
  "G#m",
  "Am",
  "Bbm",
  "Bm",
] as const;
const FLAT_KEYS: ReadonlySet<string> = new Set([
  "F",
  "Bb",
  "Eb",
  "Ab",
  "Db",
  "Gb",
  "Dm",
  "Gm",
  "Cm",
  "Fm",
  "Bbm",
  "Ebm",
]);
const SHARP_KEYS: ReadonlySet<string> = new Set([
  "G",
  "D",
  "A",
  "E",
  "B",
  "F#",
  "Em",
  "Bm",
  "F#m",
  "C#m",
  "G#m",
  "D#m",
]);

function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

function assertInteger(n: number, what: string): void {
  if (!Number.isInteger(n)) {
    throw new RangeError(`${what} must be an integer, got ${String(n)}`);
  }
}

/** Parse chord text per the grammar in `docs/CHORDPRO.md`; `null` when unparseable. */
export function parseChord(text: string): ParsedChord | null {
  const m = CHORD_RE.exec(text);
  if (!m) return null;
  const root = (m[1] as string) + (m[2] ?? "");
  const suffix = m[3] ?? "";
  if (m[4] === undefined) return { root, suffix };
  return { root, suffix, bass: m[4] + (m[5] ?? "") };
}

/** Format a parsed chord back to text. */
export function formatChord(chord: ParsedChord): string {
  return (
    chord.root +
    chord.suffix +
    (chord.bass === undefined ? "" : `/${chord.bass}`)
  );
}

/** Pitch class 0-11 of a note name (C = 0); `null` when not a note. */
export function noteToPitchClass(note: NoteName): number | null {
  const m = NOTE_RE.exec(note);
  if (!m) return null;
  const base = NATURAL_PC[m[1] as string] as number;
  const acc = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  return mod12(base + acc);
}

/** Transpose a key (`Am`, `F#`) by semitones; `null` when it is not a key. */
export function transposeKey(
  key: string,
  semitones: number,
  prefer?: SpellingPreference,
): string | null {
  assertInteger(semitones, "semitones");
  const m = KEY_RE.exec(key);
  if (!m) return null;
  const pc = noteToPitchClass(m[1] as string);
  if (pc === null) return null;
  const n = mod12(semitones);
  if (n === 0) return key;
  const target = mod12(pc + n);
  if (m[2] === "m") {
    if (target === 3) return prefer === "flat" ? "Ebm" : "D#m";
    return MINOR_KEYS[target] as string;
  }
  if (target === 6) return prefer === "flat" ? "Gb" : "F#";
  return MAJOR_KEYS[target] as string;
}

/** Options for {@link transposeChord}. */
export interface TransposeOptions {
  /** Source key used to pick the spelling style (default: none). */
  key?: string;
  /** Spelling for tie or no-key cases (default: see `docs/CHORDPRO.md`). */
  prefer?: SpellingPreference;
}

function spellingTable(
  semitones: number,
  options: TransposeOptions | undefined,
): readonly string[] {
  const prefer = options?.prefer;
  if (options?.key !== undefined) {
    const target = transposeKey(options.key, semitones, prefer);
    if (target !== null) {
      if (FLAT_KEYS.has(target)) return FLAT_NAMES;
      if (SHARP_KEYS.has(target)) return SHARP_NAMES;
    }
  }
  if (prefer === "flat") return FLAT_NAMES;
  if (prefer === "sharp") return SHARP_NAMES;
  return DEFAULT_NAMES;
}

function shiftNote(note: string, n: number, table: readonly string[]): string {
  const pc = noteToPitchClass(note) as number;
  return table[mod12(pc + n)] as string;
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
  assertInteger(semitones, "semitones");
  const parsed = parseChord(chord);
  if (!parsed) return { chord, ok: false };
  const n = mod12(semitones);
  if (n === 0) return { chord, ok: true };
  const table = spellingTable(semitones, options);
  const out: ParsedChord = {
    root: shiftNote(parsed.root, n, table),
    suffix: parsed.suffix,
  };
  if (parsed.bass !== undefined) out.bass = shiftNote(parsed.bass, n, table);
  return { chord: formatChord(out), ok: true };
}
