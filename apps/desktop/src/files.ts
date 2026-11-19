import { open } from "@tauri-apps/plugin-dialog";
import { commands } from "./bindings";
import { i18n } from "./i18n";
import type { FileError, FileErrorKind } from "./bindings";

export type { FileError, FileErrorKind };

export type FileReadErrorKind = FileErrorKind | "Ipc";

const FILE_ERROR_KINDS: readonly string[] = [
  "TooLarge",
  "NotUtf8",
  "Io",
] satisfies FileErrorKind[];

export class FileReadError extends Error {
  readonly kind: FileReadErrorKind;

  constructor(kind: FileReadErrorKind, message: string) {
    super(message);
    this.name = "FileReadError";
    this.kind = kind;
  }
}

export const SONG_FILE_EXTENSIONS = [
  "cho",
  "chopro",
  "chordpro",
  "txt",
] as const;

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
      filters: [{ name: filterName, extensions: [...SONG_FILE_EXTENSIONS] }],
    });
  } catch (reason) {
    throw toFileReadError(reason);
  }
  if (picked === null) return [];
  return typeof picked === "string" ? [picked] : picked;
}
