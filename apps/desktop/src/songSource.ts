import type { SearchHit, SongSummary } from "./storage";

const collator = new Intl.Collator(["he", "en"], {
  sensitivity: "base",
  numeric: true,
});

/** Title order (he + en collation, numeric); ties by id in UTF-16 order. Never mutates. */
export function sortByTitle(items: readonly SongSummary[]): SongSummary[] {
  return [...items].sort((a, b) => {
    const byTitle = collator.compare(a.title, b.title);
    if (byTitle !== 0) return byTitle;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export type SearchState =
  | { status: "idle" }
  | { status: "loading"; query: string }
  | { status: "done"; query: string; hits: SearchHit[] }
  | { status: "error"; query: string; message: string };

export interface DebouncedSearch {
  setQuery(q: string): void;
  cancel(): void;
}

/**
 * Debounces `search` and drops every response whose query is no longer the
 * latest issued one (an empty query counts as issued and emits `idle`).
 */
export function createDebouncedSearch(
  search: (q: string) => Promise<SearchHit[]>,
  onState: (s: SearchState) => void,
  delayMs = 150,
): DebouncedSearch {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest = 0;

  const clearTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  return {
    setQuery(q: string) {
      clearTimer();
      const query = q.trim();
      const issued = ++latest;
      if (query === "") {
        onState({ status: "idle" });
        return;
      }
      timer = setTimeout(() => {
        timer = undefined;
        if (issued !== latest) return;
        onState({ status: "loading", query });
        search(query).then(
          (hits) => {
            if (issued === latest) onState({ status: "done", query, hits });
          },
          (reason: unknown) => {
            if (issued !== latest) return;
            const message =
              reason instanceof Error ? reason.message : String(reason);
            onState({ status: "error", query, message });
          },
        );
      }, delayMs);
    },
    cancel() {
      clearTimer();
      latest += 1;
    },
  };
}

/** Aliases that keep generic type arguments out of `.tsx` files (see scripts/desktop-contract.test.ts). */
export type SummaryList = Promise<SongSummary[]>;
export type SummaryIndex = Map<string, SongSummary>;
