import { open } from "@tauri-apps/plugin-dialog";
import { commands } from "./bindings";
import { i18n } from "./i18n";
import type {
  DocError,
  DocErrorKind,
  DocumentText,
  FileError,
  FileErrorKind,
} from "./bindings";

export type { DocError, DocErrorKind, DocumentText, FileError, FileErrorKind };

export type FileReadErrorKind = FileErrorKind | "Ipc";

const FILE_ERROR_KINDS: readonly string[] = [
  "TooLarge",
  "NotUtf8",
  "Io",
  "Invalid",
] satisfies FileErrorKind[];

export class FileReadError extends Error {
  readonly kind: FileReadErrorKind;

  constructor(kind: FileReadErrorKind, message: string) {
    super(message);
    this.name = "FileReadError";
    this.kind = kind;
  }
}

export type DocumentReadErrorKind = DocErrorKind | "Ipc";

const DOC_ERROR_KINDS: readonly string[] = [
  "TooLarge",
  "TextTooLarge",
  "Unsupported",
  "Corrupt",
  "Io",
] satisfies DocErrorKind[];

export class DocumentReadError extends Error {
  readonly kind: DocumentReadErrorKind;

  constructor(kind: DocumentReadErrorKind, message: string) {
    super(message);
    this.name = "DocumentReadError";
    this.kind = kind;
  }
}

export type FileWriteErrorKind = "Invalid" | "Io" | "Ipc";

export class FileWriteError extends Error {
  readonly kind: FileWriteErrorKind;

  constructor(kind: FileWriteErrorKind, message: string) {
    super(message);
    this.name = "FileWriteError";
    this.kind = kind;
  }
}

export const SONG_FILE_EXTENSIONS = [
  "cho",
  "chopro",
  "chordpro",
  "txt",
] as const;

export const DOCUMENT_FILE_EXTENSIONS = ["docx", "odt", "rtf", "pdf"] as const;

function isDocError(value: unknown): value is DocError {
  if (typeof value !== "object" || value === null) return false;
  const { kind, message } = value as { kind?: unknown; message?: unknown };
  return (
    typeof kind === "string" &&
    DOC_ERROR_KINDS.includes(kind) &&
    typeof message === "string"
  );
}

function toDocumentReadError(reason: unknown): DocumentReadError {
  if (isDocError(reason))
    return new DocumentReadError(reason.kind, reason.message);
  if (reason instanceof Error)
    return new DocumentReadError("Ipc", reason.message);
  return new DocumentReadError("Ipc", String(reason));
}

/** Extracts a document's text blocks (docx, odt, rtf, pdf) through the backend. */
export async function extractDocument(path: string): Promise<DocumentText> {
  let result;
  try {
    result = await commands.extractDocument(path);
  } catch (reason) {
    throw toDocumentReadError(reason);
  }
  if (result.status === "error") throw toDocumentReadError(result.error);
  return result.data;
}

function isFileError(value: unknown): value is FileError {
  if (typeof value !== "object" || value === null) return false;
  const { kind, message } = value as { kind?: unknown; message?: unknown };
  return (
    typeof kind === "string" &&
    FILE_ERROR_KINDS.includes(kind) &&
    typeof message === "string"
  );
}

function toFileReadError(reason: unknown): FileReadError {
  if (isFileError(reason))
    return new FileReadError(reason.kind, reason.message);
  if (reason instanceof Error) return new FileReadError("Ipc", reason.message);
  return new FileReadError("Ipc", String(reason));
}

/** Reads a text file (UTF-8, at most 1 MiB, BOM removed) through the backend. */
export async function readTextFile(path: string): Promise<string> {
  let result;
  try {
    result = await commands.readTextFile(path);
  } catch (reason) {
    throw toFileReadError(reason);
  }
  if (result.status === "error") throw toFileReadError(result.error);
  return result.data;
}

function toFileWriteError(reason: unknown): FileWriteError {
  if (isFileError(reason)) {
    const kind = reason.kind === "Invalid" ? "Invalid" : "Io";
    return new FileWriteError(kind, reason.message);
  }
  if (reason instanceof Error) return new FileWriteError("Ipc", reason.message);
  return new FileWriteError("Ipc", String(reason));
}

/**
 * Saves a Word document: the backend opens the native save dialog and writes the file, so no
 * path ever comes from the webview. Resolves the saved path, or `null` when the user cancels.
 */
export async function saveExportDocx(
  defaultName: string,
  filterName: string,
  bytes: Uint8Array,
): Promise<string | null> {
  let result;
  try {
    result = await commands.saveExportDocx(
      defaultName,
      filterName,
      Array.from(bytes),
    );
  } catch (reason) {
    throw toFileWriteError(reason);
  }
  if (result.status === "error") throw toFileWriteError(result.error);
  return result.data;
}

/**
 * Opens the native multi-file picker; resolves to the chosen paths (empty on cancel).
 * The filter label defaults to the current language's `fileFilterSongs`, read when the dialog opens.
 */
export async function pickSongFiles(
  filterName: string = i18n.t("fileFilterSongs"),
): Promise<string[]> {
  let picked: string | string[] | null;
  try {
    picked = await open({
      multiple: true,
      directory: false,
      filters: [
        {
          name: filterName,
          extensions: [...SONG_FILE_EXTENSIONS, ...DOCUMENT_FILE_EXTENSIONS],
        },
      ],
    });
  } catch (reason) {
    throw toFileReadError(reason);
  }
  if (picked === null) return [];
  return typeof picked === "string" ? [picked] : picked;
}

/** Opens the native single-file picker for a document; resolves the path, or `undefined` on cancel. */
export async function pickDocumentFile(
  filterName: string,
): Promise<string | undefined> {
  let picked: string | string[] | null;
  try {
    picked = await open({
      multiple: false,
      directory: false,
      filters: [
        { name: filterName, extensions: [...DOCUMENT_FILE_EXTENSIONS] },
      ],
    });
  } catch (reason) {
    throw toFileReadError(reason);
  }
  if (picked === null) return undefined;
  return typeof picked === "string" ? picked : picked[0];
}
