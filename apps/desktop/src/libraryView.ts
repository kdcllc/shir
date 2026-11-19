import { sortByTitle } from "./songSource";
import type { Language, SearchHit, SongSummary } from "./storage";

export type SortOrder = "title" | "artist" | "updated";
export type LanguageFilter = "all" | "he" | "en" | "mixed";

export interface LibraryPrefs {
  sort: SortOrder;
  language: LanguageFilter;
}

export const DEFAULT_LIBRARY_PREFS: LibraryPrefs = {
  sort: "title",
  language: "all",
};

export const LIBRARY_PREFS_KEY = "shir.library";

// Same settings as the title collator in songSource.ts.
const collator = new Intl.Collator(["he", "en"], {
  sensitivity: "base",
  numeric: true,
});

function compareId(a: SongSummary, b: SongSummary): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function compareTitleThenId(a: SongSummary, b: SongSummary): number {
  return collator.compare(a.title, b.title) || compareId(a, b);
}

function artistOf(s: SongSummary): string | null {
  const artist = s.artist;
  return artist === null || artist === undefined || artist.trim() === ""
    ? null
    : artist;
}

/** Sorts a copy of `items`; never mutates the input. */
export function sortSummaries(
  items: readonly SongSummary[],
  order: SortOrder,
): SongSummary[] {
  switch (order) {
    case "title":
      return sortByTitle(items);
    case "artist":
      return [...items].sort((a, b) => {
        const aa = artistOf(a);
        const ba = artistOf(b);
        if (aa === null && ba !== null) return 1;
        if (aa !== null && ba === null) return -1;
        if (aa !== null && ba !== null) {
          const byArtist = collator.compare(aa, ba);
          if (byArtist !== 0) return byArtist;
        }
        return compareTitleThenId(a, b);
      });
    case "updated":
      return [...items].sort((a, b) => {
        if (a.updatedAt !== b.updatedAt)
          return a.updatedAt < b.updatedAt ? 1 : -1;
        return compareTitleThenId(a, b);
      });
  }
}

/** Keeps input order; `"all"` keeps everything. */
export function filterSummaries<T extends { language: Language }>(
  items: readonly T[],
  filter: LanguageFilter,
): T[] {
  return filter === "all"
    ? [...items]
    : items.filter((item) => item.language === filter);
}

/** Filters on `hit.song.language`; keeps relevance order. */
export function filterHits(
  hits: readonly SearchHit[],
  filter: LanguageFilter,
): SearchHit[] {
  return filter === "all"
    ? [...hits]
    : hits.filter((hit) => hit.song.language === filter);
}

function isSortOrder(v: unknown): v is SortOrder {
  return v === "title" || v === "artist" || v === "updated";
}

function isLanguageFilter(v: unknown): v is LanguageFilter {
  return v === "all" || v === "he" || v === "en" || v === "mixed";
}

/** Reads the persisted prefs; every field falls back to its default. Never throws. */
export function readLibraryPrefs(
  storage: Pick<Storage, "getItem"> | undefined,
): LibraryPrefs {
  try {
    const raw = storage?.getItem(LIBRARY_PREFS_KEY);
    if (typeof raw !== "string") return { ...DEFAULT_LIBRARY_PREFS };
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return { ...DEFAULT_LIBRARY_PREFS };
    }
    const obj = parsed as Record<string, unknown>;
    return {
      sort: isSortOrder(obj.sort) ? obj.sort : DEFAULT_LIBRARY_PREFS.sort,
      language: isLanguageFilter(obj.language)
        ? obj.language
        : DEFAULT_LIBRARY_PREFS.language,
    };
  } catch {
    return { ...DEFAULT_LIBRARY_PREFS };
  }
}

/** Persists the prefs; never throws. */
export function storeLibraryPrefs(
  storage: Pick<Storage, "setItem"> | undefined,
  prefs: LibraryPrefs,
): void {
  try {
    storage?.setItem(
      LIBRARY_PREFS_KEY,
      JSON.stringify({ sort: prefs.sort, language: prefs.language }),
    );
  } catch {
    // Persistence is best-effort.
  }
}
