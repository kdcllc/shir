import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebouncedSearch, sortByTitle } from "./songSource";
import type { SearchState } from "./songSource";
import type { SearchHit, SongSummary } from "./storage";

function summary(id: string, title: string): SongSummary {
  return {
    id,
    title,
    artist: null,
    key: null,
    language: "en",
    updatedAt: "2026-01-01T00:00:00Z",
  } as SongSummary;
}

function hit(id: string): SearchHit {
  return { song: summary(id, id), snippet: null };
}

describe("sortByTitle", () => {
  const order = (items: SongSummary[]) =>
    sortByTitle(items).map((s) => s.title);

  it("orders Hebrew titles among themselves", () => {
    expect(order([summary("1", "תודה"), summary("2", "אהבה")])).toEqual([
      "אהבה",
      "תודה",
    ]);
  });

  it("orders Latin titles with base sensitivity", () => {
    expect(order([summary("1", "banana"), summary("2", "Apple")])).toEqual([
      "Apple",
      "banana",
    ]);
  });

  it("orders numbers numerically", () => {
    expect(order([summary("1", "Song 10"), summary("2", "Song 2")])).toEqual([
      "Song 2",
      "Song 10",
    ]);
  });

  it("ignores case: titles differing only by case fall to the id tie-break", () => {
    // Case-sensitive collation would put "apple" first; base sensitivity ties, so id decides.
    expect(
      sortByTitle([summary("2", "apple"), summary("1", "Apple")]).map(
        (s) => s.id,
      ),
    ).toEqual(["1", "2"]);
  });

  it("ignores accents: titles differing only by accent fall to the id tie-break", () => {
    // Accent-sensitive collation would put "resume" first; base sensitivity ties, so id decides.
    expect(
      sortByTitle([summary("2", "resume"), summary("1", "résumé")]).map(
        (s) => s.id,
      ),
    ).toEqual(["1", "2"]);
  });

  it("breaks ties by id in code-unit order and does not mutate the input", () => {
    const input = [
      summary("b", "Same"),
      summary("B", "same"),
      summary("a", "Same"),
    ];
    const snapshot = [...input];
    const out = sortByTitle(input);
    expect(out.map((s) => s.id)).toEqual(["B", "a", "b"]);
    expect(input).toEqual(snapshot);
    expect(out).not.toBe(input);
  });
});

describe("createDebouncedSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(
    search: (q: string) => Promise<SearchHit[]> = vi.fn(() =>
      Promise.resolve([hit("x")]),
    ),
  ) {
    const states: SearchState[] = [];
    const d = createDebouncedSearch(search, (s) => states.push(s));
    return { search, states, d };
  }

  it("emits idle for an empty or blank query without calling search", async () => {
    const { search, states, d } = setup();
    d.setQuery("   ");
    expect(states).toEqual([{ status: "idle" }]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(search).not.toHaveBeenCalled();
  });

  it("calls search once with the trimmed query after the default 150 ms", async () => {
    const { search, states, d } = setup();
    d.setQuery("  shalom ");
    await vi.advanceTimersByTimeAsync(149);
    expect(search).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("shalom");
    expect(states).toEqual([
      { status: "loading", query: "shalom" },
      { status: "done", query: "shalom", hits: [hit("x")] },
    ]);
  });

  it("makes one call after a burst of three keystrokes", async () => {
    const { search, d } = setup();
    d.setQuery("s");
    await vi.advanceTimersByTimeAsync(50);
    d.setQuery("sh");
    await vi.advanceTimersByTimeAsync(50);
    d.setQuery("sha");
    await vi.advanceTimersByTimeAsync(1000);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("sha");
  });

  it("drops the response when the query is cleared after the search started", async () => {
    let resolve!: (h: SearchHit[]) => void;
    const search = vi.fn(() => new Promise<SearchHit[]>((r) => (resolve = r)));
    const { states, d } = setup(search);
    d.setQuery("abc");
    await vi.advanceTimersByTimeAsync(150);
    expect(search).toHaveBeenCalledTimes(1);
    d.setQuery("");
    resolve([hit("late")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(states.map((s) => s.status)).toEqual(["loading", "idle"]);
    expect(states.some((s) => s.status === "done")).toBe(false);
  });

  it("drops an out-of-order response that resolves last", async () => {
    const resolvers: Record<string, (h: SearchHit[]) => void> = {};
    const search = vi.fn(
      (q: string) =>
        new Promise<SearchHit[]>((r) => {
          resolvers[q] = r;
        }),
    );
    const { states, d } = setup(search);
    d.setQuery("a");
    await vi.advanceTimersByTimeAsync(150);
    d.setQuery("ab");
    await vi.advanceTimersByTimeAsync(150);
    resolvers.ab!([hit("new")]);
    await vi.advanceTimersByTimeAsync(0);
    resolvers.a!([hit("old")]);
    await vi.advanceTimersByTimeAsync(0);
    const done = states.filter((s) => s.status === "done");
    expect(done).toEqual([{ status: "done", query: "ab", hits: [hit("new")] }]);
  });

  it("drops a stale error that rejects after a newer query resolved", async () => {
    const settle: Record<
      string,
      { ok: (h: SearchHit[]) => void; fail: (e: Error) => void }
    > = {};
    const search = vi.fn(
      (q: string) =>
        new Promise<SearchHit[]>((ok, fail) => {
          settle[q] = { ok, fail };
        }),
    );
    const { states, d } = setup(search);
    d.setQuery("a");
    await vi.advanceTimersByTimeAsync(150);
    d.setQuery("ab");
    await vi.advanceTimersByTimeAsync(150);
    settle.ab!.ok([hit("new")]);
    await vi.advanceTimersByTimeAsync(0);
    settle.a!.fail(new Error("late"));
    await vi.advanceTimersByTimeAsync(0);
    expect(states.some((s) => s.status === "error")).toBe(false);
    expect(states.at(-1)).toEqual({
      status: "done",
      query: "ab",
      hits: [hit("new")],
    });
  });

  it("reports an error, then recovers on the next query", async () => {
    const search = vi
      .fn<(q: string) => Promise<SearchHit[]>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([hit("ok")]);
    const { states, d } = setup(search);
    d.setQuery("a");
    await vi.advanceTimersByTimeAsync(150);
    expect(states.at(-1)).toEqual({
      status: "error",
      query: "a",
      message: "boom",
    });
    d.setQuery("b");
    await vi.advanceTimersByTimeAsync(150);
    expect(states.at(-1)).toEqual({
      status: "done",
      query: "b",
      hits: [hit("ok")],
    });
  });

  it("cancel drops pending timers and in-flight responses", async () => {
    let resolve!: (h: SearchHit[]) => void;
    const search = vi.fn(() => new Promise<SearchHit[]>((r) => (resolve = r)));
    const { states, d } = setup(search);
    d.setQuery("pending");
    d.cancel();
    await vi.advanceTimersByTimeAsync(500);
    expect(search).not.toHaveBeenCalled();
    d.setQuery("flight");
    await vi.advanceTimersByTimeAsync(150);
    d.cancel();
    resolve([hit("late")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(states.map((s) => s.status)).toEqual(["loading"]);
  });

  it("honours a custom delay", async () => {
    const search = vi.fn(() => Promise.resolve([]));
    const d = createDebouncedSearch(search, () => undefined, 10);
    d.setQuery("q");
    await vi.advanceTimersByTimeAsync(10);
    expect(search).toHaveBeenCalledTimes(1);
  });
});
