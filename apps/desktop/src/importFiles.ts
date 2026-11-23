import type {
  DocumentInput,
  DocumentTextResult,
  ImportOptions,
  ImportResult,
  RtlColumns,
} from "chord-core";
import type {
  DocErrorKind,
  DocFormat,
  DocWarning,
  DocumentText,
} from "./bindings";
import type { Song } from "./storage";

/** Extensions (lower case) whose text is ChordPro already: strict passthrough, never converted. */
const CHORDPRO_EXTENSIONS: readonly string[] = [".cho", ".chopro", ".chordpro"];

/**
 * Document extensions (lower case). Kept as literals, not imported from `./files`, because the
 * App tests replace that module wholesale; a test pins them to `DOCUMENT_FILE_EXTENSIONS`.
 */
export const DOCUMENT_EXTENSIONS: readonly string[] = [
  ".docx",
  ".odt",
  ".rtf",
  ".pdf",
];

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
  return withTitle(chordpro, baseNameOf(path));
}

/**
 * Prepends `{title: <title>}` unless the text already has a `{title` / `{t:` directive
 * or the trimmed title is empty.
 */
export function withTitle(chordpro: string, title: string): string {
  if (TITLE_DIRECTIVE.test(chordpro)) return chordpro;
  const trimmed = title.trim();
  if (trimmed === "") return chordpro;
  return `{title: ${trimmed}}\n${chordpro}`;
}

/** Source and title of an AI song under review, kept as two values so each can be isolated. */
export interface ReviewLabel {
  source: string;
  title: string;
}

export interface FileImportDeps {
  pickSongFiles(): Promise<string[]>;
  readTextFile(path: string): Promise<string>;
  saveSong(chordpro: string, id?: string): Promise<Song>;
  importText(text: string, options?: ImportOptions): ImportResult;
  extractDocument(path: string): Promise<DocumentText>;
  documentToText(doc: DocumentInput): DocumentTextResult;
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
  /** Column order of a document's table rows; absent means `"mirror"`. */
  rtlColumns?: RtlColumns;
  /** Display label of an AI song. When set, the UI shows it, not `fileNameOf(path)`. */
  label?: ReviewLabel;
  /** Present for a converted document: its extracted text, format and warnings. */
  document?: {
    name: string;
    format: DocFormat;
    text: string;
    warnings: DocWarning[];
  };
}

export interface FailedFile {
  path: string;
  message: string;
  /** Machine-readable cause of a document failure; absent for text files. */
  reason?: DocErrorKind | "Ipc" | "NoText";
}

export interface FileImportReport {
  saved: SavedFile[];
  queued: QueuedFile[];
  failed: FailedFile[];
}

/** Known document failure kinds; a `Record` keeps it exhaustive against `bindings.ts`. */
const DOC_FAILURE_KINDS: Readonly<Record<DocErrorKind | "Ipc", true>> = {
  TooLarge: true,
  TextTooLarge: true,
  Unsupported: true,
  Corrupt: true,
  Io: true,
  Ipc: true,
};

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** The `kind` of a `DocumentReadError` (duck-typed, see above), else `"Ipc"`. */
function documentFailureReason(reason: unknown): DocErrorKind | "Ipc" {
  const kind = (reason as { kind?: unknown } | null)?.kind;
  return typeof kind === "string" && Object.hasOwn(DOC_FAILURE_KINDS, kind)
    ? (kind as DocErrorKind | "Ipc")
    : "Ipc";
}

async function importDocument(
  deps: FileImportDeps,
  path: string,
  name: string,
  report: FileImportReport,
): Promise<void> {
  let doc: DocumentText;
  try {
    doc = await deps.extractDocument(path);
  } catch (reason) {
    report.failed.push({
      path,
      message: messageOf(reason),
      reason: documentFailureReason(reason),
    });
    return;
  }
  try {
    if (doc.blocks.length === 0) {
      const noText = doc.warnings.find((w) => w.kind === "PdfNoText");
      report.failed.push({
        path,
        message: noText?.message ?? "no text found",
        reason: "NoText",
      });
      return;
    }
    const { text, rtlColumns } = deps.documentToText(doc);
    const result = deps.importText(text, { rtlColumns });
    report.queued.push({
      path,
      source: text,
      result: { ...result, chordpro: withTitleFallback(result.chordpro, path) },
      rtlColumns,
      document: { name, format: doc.format, text, warnings: doc.warnings },
    });
  } catch (reason) {
    report.failed.push({
      path,
      message: messageOf(reason),
      reason: "Corrupt",
    });
  }
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
    const name = fileNameOf(path);
    if (DOCUMENT_EXTENSIONS.includes(extensionOf(name))) {
      await importDocument(deps, path, name, report);
      continue;
    }
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
