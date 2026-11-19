import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIBRARY_PREFS,
  LIBRARY_PREFS_KEY,
  filterHits,
  filterSummaries,
  readLibraryPrefs,
  sortSummaries,
  storeLibraryPrefs,
} from "./libraryView";
import { sortByTitle } from "./songSource";
import type { Language, SearchHit, SongSummary } from "./storage";

function s(
  id: string,
  title: string,
  artist: string | null | undefined = null,
  updatedAt = "2026-01-01T00:00:00Z",
  language: Language = "en",
): SongSummary {
  return { id, title, artist, key: null, language, updatedAt } as SongSummary;
}

const ids = (items: readonly { id: string }[]) => items.map((i) => i.id);

describe("constants", () => {
  it("pins the defaults and the storage key", () => {
    expect(DEFAULT_LIBRARY_PREFS).toEqual({ sort: "title", language: "all" });
    expect(LIBRARY_PREFS_KEY).toBe("shir.library");
  });
});

describe("sortSummaries", () => {
  const sample = [
    s("1", "תודה", "אברהם"),
    s("2", "Banana", "Zed"),
    s("3", "אהבה", null),
    s("4", "Apple", "  "),
    s("5", "Cherry", ""),
    { ...s("6", "Mixed שיר"), artist: undefined } as SongSummary,
  ];

  it("title equals sortByTitle", () => {
    expect(sortSummaries(sample, "title")).toEqual(sortByTitle(sample));
  });

  it("artist: Hebrew and English artists by collation, missing artists last", () => {
    const out = sortSummaries(sample, "artist");
    // Hebrew sorts before Latin under the he+en collator? derive from the same collator.
    const collator = new Intl.Collator(["he", "en"], {
      sensitivity: "base",
      numeric: true,
    });
    const withArtist = ["אברהם", "Zed"].sort(collator.compare);
    expect(out.slice(0, 2).map((x) => x.artist)).toEqual(withArtist);
    // missing artists (null, undefined, "", whitespace) by title: Apple, Cherry, Mixed שיר, אהבה
    expect(ids(out.slice(2))).toEqual(
      ids(sortByTitle(sample.filter((x) => !x.artist?.trim()))),
    );
  });

  it("artist: blank artists never precede a real one", () => {
    const out = sortSummaries(
      [s("a", "A", ""), s("b", "B", "  "), s("c", "C", null), s("d", "Z", "Z")],
      "artist",
    );
    expect(ids(out)).toEqual(["d", "a", "b", "c"]);
  });

  it("artist: equal artists (case/accent-insensitive) tie by title then id", () => {
    const out = sortSummaries(
      [
        s("4", "Same", "Beyoncé"),
        s("3", "Same", "beyonce"),
        s("2", "Alpha", "BEYONCE"),
        s("1", "Same", "Beyonce"),
      ],
      "artist",
    );
    expect(ids(out)).toEqual(["2", "1", "3", "4"]);
  });

  it("artist: compares artists numerically", () => {
    const out = sortSummaries(
      [s("1", "x", "Band 10"), s("2", "x", "Band 2")],
      "artist",
    );
    expect(ids(out)).toEqual(["2", "1"]);
  });

  it("updated: newest first, ties by title then id", () => {
    const out = sortSummaries(
      [
        s("1", "Old", null, "2025-01-01T00:00:00Z"),
        s("2", "Zeta", null, "2026-06-01T00:00:00Z"),
        s("4", "Alpha", null, "2026-06-01T00:00:00Z"),
        s("3", "Alpha", null, "2026-06-01T00:00:00Z"),
        s("5", "New", null, "2026-07-01T00:00:00Z"),
      ],
      "updated",
    );
    expect(ids(out)).toEqual(["5", "3", "4", "2", "1"]);
  });

  it("updated: ids break ties in UTF-16 order, not by title when titles are equal", () => {
    const out = sortSummaries(
      [s("b", "Same"), s("B", "same"), s("a", "Same")],
      "updated",
    );
    expect(ids(out)).toEqual(["B", "a", "b"]);
  });

  it("never mutates a frozen input", () => {
    for (const order of ["title", "artist", "updated"] as const) {
      const input = Object.freeze([...sample]);
      const out = sortSummaries(input, order);
      expect(out).not.toBe(input);
      expect(ids(input)).toEqual(ids(sample));
    }
  });
});

describe("filterSummaries / filterHits", () => {
  const items = [
    s("1", "a", null, undefined, "he"),
    s("2", "b", null, undefined, "en"),
    s("3", "c", null, undefined, "mixed"),
    s("4", "d", null, undefined, "he"),
  ];

  it("all keeps everything in order, as a copy", () => {
    const frozen = Object.freeze([...items]);
    const out = filterSummaries(frozen, "all");
    expect(ids(out)).toEqual(["1", "2", "3", "4"]);
    expect(out).not.toBe(frozen);
  });

  it.each([
    ["he", ["1", "4"]],
    ["en", ["2"]],
    ["mixed", ["3"]],
  ] as const)("keeps only %s, in input order", (filter, expected) => {
    expect(ids(filterSummaries(Object.freeze([...items]), filter))).toEqual(
      expected,
    );
  });

  it("filters hits on song.language and keeps relevance order", () => {
    const hits: SearchHit[] = [
      { song: items[3]!, snippet: "x" },
      { song: items[1]!, snippet: null },
      { song: items[0]!, snippet: null },
    ] as SearchHit[];
    const frozen = Object.freeze([...hits]);
    expect(filterHits(frozen, "he").map((h) => h.song.id)).toEqual(["4", "1"]);
    expect(filterHits(frozen, "mixed")).toEqual([]);
    expect(filterHits(frozen, "all").map((h) => h.song.id)).toEqual([
      "4",
      "2",
      "1",
    ]);
  });
});

describe("readLibraryPrefs / storeLibraryPrefs", () => {
  const reading = (raw: string | null) => ({ getItem: () => raw });

  it("returns defaults for missing storage, key, bad JSON, non-objects", () => {
    expect(readLibraryPrefs(undefined)).toEqual(DEFAULT_LIBRARY_PREFS);
    expect(readLibraryPrefs(reading(null))).toEqual(DEFAULT_LIBRARY_PREFS);
    expect(readLibraryPrefs(reading("{nope"))).toEqual(DEFAULT_LIBRARY_PREFS);
    for (const raw of ["null", "42", '"artist"', "[1]", "true"]) {
      expect(readLibraryPrefs(reading(raw))).toEqual(DEFAULT_LIBRARY_PREFS);
    }
  });

  it("returns defaults when getItem throws, and queries the right key", () => {
    expect(
      readLibraryPrefs({
        getItem: () => {
          throw new Error("denied");
        },
      }),
    ).toEqual(DEFAULT_LIBRARY_PREFS);
    const keys: string[] = [];
    readLibraryPrefs({
      getItem: (k) => {
        keys.push(k);
        return null;
      },
    });
    expect(keys).toEqual(["shir.library"]);
  });

  it("reads valid values", () => {
    expect(
      readLibraryPrefs(reading('{"sort":"updated","language":"he"}')),
    ).toEqual({ sort: "updated", language: "he" });
    expect(
      readLibraryPrefs(reading('{"sort":"artist","language":"mixed"}')),
    ).toEqual({ sort: "artist", language: "mixed" });
  });

  it("validates each field separately", () => {
    expect(
      readLibraryPrefs(reading('{"sort":"artist","language":"fr"}')),
    ).toEqual({ sort: "artist", language: "all" });
    expect(
      readLibraryPrefs(reading('{"sort":"bogus","language":"en"}')),
    ).toEqual({ sort: "title", language: "en" });
    expect(readLibraryPrefs(reading('{"sort":"updated"}'))).toEqual({
      sort: "updated",
      language: "all",
    });
    expect(readLibraryPrefs(reading('{"sort":1,"language":null}'))).toEqual(
      DEFAULT_LIBRARY_PREFS,
    );
  });

  it("returns a fresh object, not the shared default", () => {
    expect(readLibraryPrefs(undefined)).not.toBe(DEFAULT_LIBRARY_PREFS);
  });

  it("stores exactly sort and language as JSON under the key", () => {
    const calls: [string, string][] = [];
    storeLibraryPrefs({ setItem: (k, v) => void calls.push([k, v]) }, {
      sort: "artist",
      language: "he",
      extra: 1,
    } as never);
    expect(calls).toEqual([
      ["shir.library", '{"sort":"artist","language":"he"}'],
    ]);
  });

  it("round-trips and never throws", () => {
    let stored = "";
    storeLibraryPrefs(
      { setItem: (_k, v) => void (stored = v) },
      { sort: "updated", language: "mixed" },
    );
    expect(readLibraryPrefs(reading(stored))).toEqual({
      sort: "updated",
      language: "mixed",
    });
    expect(() =>
      storeLibraryPrefs(
        {
          setItem: () => {
            throw new Error("quota");
          },
        },
        DEFAULT_LIBRARY_PREFS,
      ),
    ).not.toThrow();
    expect(() =>
      storeLibraryPrefs(undefined, DEFAULT_LIBRARY_PREFS),
    ).not.toThrow();
  });
});
