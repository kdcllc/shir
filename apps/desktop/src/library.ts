import { parseSong } from "chord-core";
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
  for (const line of song.lines) {
    if (line.kind === "meta" && line.name === name) {
      const value = line.value.trim();
      if (value !== "") return value;
    }
  }
  return undefined;
}

/**
 * Builds library entries from a path-to-text map: keeps `.cho` files except
 * `.canonical.cho`, sorts by `fileName` in UTF-16 code-unit order, never throws.
 */
export function buildLibrary(
  sources: Readonly<Record<string, string>>,
  group: SongGroup,
): LibrarySong[] {
  const entries: LibrarySong[] = [];
  for (const [path, source] of Object.entries(sources)) {
    const fileName = path.slice(path.lastIndexOf("/") + 1);
    if (!fileName.endsWith(".cho") || fileName.endsWith(".canonical.cho")) {
      continue;
    }
    const baseName = fileName.slice(0, -".cho".length);
    const { song, diagnostics } = parseSong(source);
    const title = song.title?.trim() || baseName;
    const artist = songMeta(song, "artist");
    const entry: LibrarySong = {
      id: `${group}:${baseName}`,
      group,
      fileName,
      title,
      song,
      diagnostics,
    };
    if (artist !== undefined) entry.artist = artist;
    entries.push(entry);
  }
  return entries.sort((a, b) =>
    a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0,
  );
}

const sampleSources = import.meta.glob("../../../samples/*.cho", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const testSongSources = import.meta.glob(
  "../../../packages/test-fixtures/fixtures/*.cho",
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

let library: LibrarySong[] | undefined;

/**
 * The bundled library: `samples/*.cho` (group `samples`) followed by
 * `packages/test-fixtures/fixtures/*.cho` (group `test-songs`).
 */
export function loadLibrary(): LibrarySong[] {
  library ??= [
    ...buildLibrary(sampleSources, "samples"),
    ...buildLibrary(testSongSources, "test-songs"),
  ];
  return library;
}

/**
 * Capo choices: `0..12` ascending, plus `songCapo` appended when it is an
 * integer in 13..24.
 */
export function capoOptions(songCapo: number | undefined): number[] {
  const options = Array.from({ length: 13 }, (_, i) => i);
  if (
    songCapo !== undefined &&
    Number.isInteger(songCapo) &&
    songCapo >= 13 &&
    songCapo <= 24
  ) {
    options.push(songCapo);
  }
  return options;
}
