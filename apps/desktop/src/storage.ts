import { commands } from "./bindings";
import type {
  DbError,
  ErrorKind,
  Language,
  SearchHit,
  Setlist,
  SetlistItem,
  SetlistSummary,
  Song,
  SongSummary,
} from "./bindings";

export type {
  DbError,
  ErrorKind,
  Language,
  SearchHit,
  Setlist,
  SetlistItem,
  SetlistSummary,
  Song,
  SongSummary,
};

export type StorageErrorKind = ErrorKind | "Ipc";

const ERROR_KINDS: readonly string[] = [
  "NotFound",
  "Invalid",
  "Storage",
  "Migration",
  "Unavailable",
] satisfies ErrorKind[];

export class StorageError extends Error {
  readonly kind: StorageErrorKind;

  constructor(kind: StorageErrorKind, message: string) {
    super(message);
    this.name = "StorageError";
    this.kind = kind;
  }
}

function isDbError(value: unknown): value is DbError {
  if (typeof value !== "object" || value === null) return false;
  const { kind, message } = value as { kind?: unknown; message?: unknown };
  return (
    typeof kind === "string" &&
    ERROR_KINDS.includes(kind) &&
    typeof message === "string"
  );
}

/** Maps any failure value (error result or rejection reason) to a StorageError. */
function toStorageError(reason: unknown): StorageError {
  if (isDbError(reason)) return new StorageError(reason.kind, reason.message);
  if (reason instanceof Error) return new StorageError("Ipc", reason.message);
  return new StorageError("Ipc", String(reason));
}

type CommandResult<T> =
  { status: "ok"; data: T } | { status: "error"; error: unknown };

async function run<T>(call: () => Promise<CommandResult<T>>): Promise<T> {
  let result: CommandResult<T>;
  try {
    result = await call();
  } catch (reason) {
    throw toStorageError(reason);
  }
  if (result.status === "error") throw toStorageError(result.error);
  return result.data;
}

/** Creates a song (no `id`) or updates the song with the given `id`. */
export function saveSong(chordpro: string, id?: string): Promise<Song> {
  return run(() => commands.saveSong({ id: id ?? null, chordpro }));
}

export function getSong(id: string): Promise<Song> {
  return run(() => commands.getSong(id));
}

export function listSongs(): Promise<SongSummary[]> {
  return run(() => commands.listSongs());
}

export async function deleteSong(id: string): Promise<void> {
  await run(() => commands.deleteSong(id));
}

export function searchSongs(query: string): Promise<SearchHit[]> {
  return run(() => commands.searchSongs(query));
}

export function listSetlists(): Promise<SetlistSummary[]> {
  return run(() => commands.listSetlists());
}

export function getSetlist(id: string): Promise<Setlist> {
  return run(() => commands.getSetlist(id));
}

export function createSetlist(name: string): Promise<Setlist> {
  return run(() => commands.createSetlist(name));
}

export function renameSetlist(id: string, name: string): Promise<Setlist> {
  return run(() => commands.renameSetlist(id, name));
}

export async function deleteSetlist(id: string): Promise<void> {
  await run(() => commands.deleteSetlist(id));
}

export function duplicateSetlist(id: string, name: string): Promise<Setlist> {
  return run(() => commands.duplicateSetlist(id, name));
}

export function addSetlistItems(
  setlistId: string,
  songIds: string[],
): Promise<Setlist> {
  return run(() => commands.addSetlistItems(setlistId, songIds));
}

export function removeSetlistItem(
  setlistId: string,
  itemId: string,
): Promise<Setlist> {
  return run(() => commands.removeSetlistItem(setlistId, itemId));
}

export function reorderSetlistItems(
  setlistId: string,
  itemIds: string[],
): Promise<Setlist> {
  return run(() => commands.reorderSetlistItems(setlistId, itemIds));
}

/** `capo: null` means "use the song's own capo". */
export function updateSetlistItem(
  setlistId: string,
  itemId: string,
  transpose: number,
  capo: number | null,
): Promise<Setlist> {
  return run(() =>
    commands.updateSetlistItem(setlistId, itemId, transpose, capo),
  );
}

/** Forwards a webview error to the app's stderr. Never rejects. */
export async function logWebviewError(message: string): Promise<void> {
  try {
    await commands.logWebviewError(message);
  } catch {
    // Best effort: a missing runtime or failed invoke must not raise.
  }
}
