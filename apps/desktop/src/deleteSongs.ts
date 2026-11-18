/** Result of a delete run: ids that are gone and ids that could not be removed. */
export interface DeleteOutcome {
  deleted: string[];
  failed: { id: string; message: string }[];
}

/** Alias that keeps the generic type argument out of `.tsx` files (see scripts/desktop-contract.test.ts). */
export type SongIdSet = ReadonlySet<string>;

/** A song that is already missing counts as deleted. */
function isNotFound(reason: unknown): boolean {
  return (
    typeof reason === "object" &&
    reason !== null &&
    "kind" in reason &&
    reason.kind === "NotFound"
  );
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * Removes each id once, one after another in the given order. A failure never
 * stops the remaining ids, and the returned promise never rejects.
 */
export async function deleteMany(
  ids: readonly string[],
  remove: (id: string) => Promise<void>,
): Promise<DeleteOutcome> {
  const outcome: DeleteOutcome = { deleted: [], failed: [] };
  for (const id of new Set(ids)) {
    try {
      await remove(id);
      outcome.deleted.push(id);
    } catch (reason) {
      if (isNotFound(reason)) outcome.deleted.push(id);
      else outcome.failed.push({ id, message: messageOf(reason) });
    }
  }
  return outcome;
}
