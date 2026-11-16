import type { ImportOptions, ImportResult } from "chord-core";
import type { Song } from "./storage";

/** Extensions (lower case) whose text is ChordPro already: strict passthrough, never converted. */
const CHORDPRO_EXTENSIONS: readonly string[] = [".cho", ".chopro", ".chordpro"];

const TITLE_DIRECTIVE = /^\s*\{\s*(?:title\b|t\s*:)/im;

/** Last path segment, split on both `/` and `\`. */
export function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

function baseNameOf(path: string): string {
  const name = fileNameOf(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Prepends `{title: <file name without extension>}` unless the text already has a
 * `{title` / `{t:` directive. The one shared title-fallback rule (import and Flip).
 */
export function withTitleFallback(chordpro: string, path: string): string {
  if (TITLE_DIRECTIVE.test(chordpro)) return chordpro;
  const base = baseNameOf(path).trim();
  if (base === "") return chordpro;
  return `{title: ${base}}\n${chordpro}`;
}

export interface FileImportDeps {
  pickSongFiles(): Promise<string[]>;
  readTextFile(path: string): Promise<string>;
  saveSong(chordpro: string, id?: string): Promise<Song>;
  importText(text: string, options?: ImportOptions): ImportResult;
}

export interface SavedFile {
  path: string;
  song: Song;
  /** True when per-line conversion changed the text (a `.txt` chords-over-lyrics sheet). */
  converted: boolean;
}

export interface QueuedFile {
  path: string;
  /** The file text as read, the source for Flip alignment. */
  source: string;
  /** Import result whose `chordpro` already carries the title fallback. */
  result: ImportResult;
}

export interface FailedFile {
  path: string;
  message: string;
}

export interface FileImportReport {
  saved: SavedFile[];
  queued: QueuedFile[];
  failed: FailedFile[];
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * Picks song files and imports each one. ChordPro files and files without RTL
 * chords are saved at once; files with RTL chords-over-lyrics are queued for
 * review (B9). One file's failure never stops the others. An empty pick resolves
 * to an empty report.
 */
export async function importSongFiles(
  deps: FileImportDeps,
): Promise<FileImportReport> {
  const report: FileImportReport = { saved: [], queued: [], failed: [] };
  const paths = await deps.pickSongFiles();
  for (const path of paths) {
    try {
      const text = await deps.readTextFile(path);
      const result: ImportResult = CHORDPRO_EXTENSIONS.includes(
        extensionOf(fileNameOf(path)),
      )
        ? {
            chordpro: text,
            format: "chordpro",
            warnings: [],
            hasRtlChords: false,
          }
        : deps.importText(text);
      const chordpro = withTitleFallback(result.chordpro, path);
      if (result.hasRtlChords) {
        report.queued.push({
          path,
          source: text,
          result: { ...result, chordpro },
        });
      } else {
        const song = await deps.saveSong(chordpro);
        report.saved.push({
          path,
          song,
          converted: result.format === "chords-over-lyrics",
        });
      }
    } catch (reason) {
      report.failed.push({ path, message: messageOf(reason) });
    }
  }
  return report;
}
