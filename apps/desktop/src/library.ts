import type { Diagnostic, SongModel } from "chord-core";

/** Library group; `samples` come first, then `test-songs`. */
export type SongGroup = "samples" | "test-songs";

/** One bundled song with its parse result. */
export interface LibrarySong {
  /** `${group}:${baseName}`, e.g. `samples:demo-shir-bilingual`. */
  id: string;
  /** Group the song belongs to. */
  group: SongGroup;
  /** Base name with the `.cho` extension. */
  fileName: string;
  /** `song.title` when non-empty after trimming; otherwise the base name. */
  title: string;
  /** First non-empty trimmed `artist` meta value; absent otherwise. */
  artist?: string;
  /** `parseSong(source).song`. */
  song: SongModel;
  /** `parseSong(source).diagnostics`. */
  diagnostics: Diagnostic[];
}

/**
 * Trimmed value of the first `meta` line named `name` whose trimmed value is
 * non-empty; otherwise `undefined`.
 */
export function songMeta(song: SongModel, name: string): string | undefined {
  void song;
  void name;
  throw new Error("not implemented");
}

/**
 * Builds library entries from a path-to-text map: keeps `.cho` files except
 * `.canonical.cho`, sorts by `fileName` in UTF-16 code-unit order, never throws.
 */
export function buildLibrary(
  sources: Readonly<Record<string, string>>,
  group: SongGroup,
): LibrarySong[] {
  void sources;
  void group;
  throw new Error("not implemented");
}

/**
 * The bundled library: `samples/*.cho` (group `samples`) followed by
 * `packages/test-fixtures/fixtures/*.cho` (group `test-songs`).
 */
export function loadLibrary(): LibrarySong[] {
  throw new Error("not implemented");
}

/**
 * Capo choices: `0..12` ascending, plus `songCapo` appended when it is an
 * integer in 13..24.
 */
export function capoOptions(songCapo: number | undefined): number[] {
  void songCapo;
  throw new Error("not implemented");
}
