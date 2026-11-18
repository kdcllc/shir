import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  COALESCE_MS,
  HISTORY_LIMIT,
  historyReducer,
  initialHistory,
  useHistory,
} from "./useHistory";

/** A hook under test with a hand-driven clock. */
function setup(initial = "a") {
  const clock = { t: 1000 };
  const now = () => clock.t;
  const hook = renderHook(() => useHistory(initial, now));
  return { clock, ...hook };
}

describe("constants", () => {
  it("keeps 200 entries and coalesces within 500 ms", () => {
    expect(HISTORY_LIMIT).toBe(200);
    expect(COALESCE_MS).toBe(500);
  });
});

describe("useHistory", () => {
  it("starts with the initial value and nothing to undo or redo", () => {
    const { result } = setup("start");
    expect(result.current.value).toBe("start");
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("set pushes the current value on the undo stack", () => {
    const { result } = setup("a");
    act(() => result.current.set("b"));
    expect(result.current.value).toBe("b");
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it("set with the current value does nothing", () => {
    const { result } = setup("a");
    act(() => result.current.set("a"));
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.set("b"));
    act(() => result.current.undo());
    expect(result.current.canRedo).toBe(true);
    // An equal value neither pushes an entry nor clears the redo stack.
    act(() => result.current.set("a"));
    expect(result.current.value).toBe("a");
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });

  it("undo restores the previous entry and redo is its inverse", () => {
    const { result } = setup("a");
    act(() => result.current.set("b"));
    act(() => result.current.set("c"));
    act(() => result.current.undo());
    expect(result.current.value).toBe("b");
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.undo());
    expect(result.current.value).toBe("a");
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.redo());
    expect(result.current.value).toBe("b");
    act(() => result.current.redo());
    expect(result.current.value).toBe("c");
    expect(result.current.canRedo).toBe(false);
    expect(result.current.canUndo).toBe(true);
  });

  it("undo and redo are no-ops when there is nothing to step to", () => {
    const { result } = setup("a");
    act(() => result.current.undo());
    expect(result.current.value).toBe("a");
    act(() => result.current.redo());
    expect(result.current.value).toBe("a");
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("set clears the redo stack", () => {
    const { result } = setup("a");
    act(() => result.current.set("b"));
    act(() => result.current.undo());
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.set("c"));
    expect(result.current.canRedo).toBe(false);
    act(() => result.current.redo());
    expect(result.current.value).toBe("c");
    act(() => result.current.undo());
    expect(result.current.value).toBe("a");
  });

  it("coalescing sets inside the window share one undo entry", () => {
    const { result, clock } = setup("a");
    act(() => result.current.set("ab", { coalesce: true }));
    clock.t += COALESCE_MS - 1;
    act(() => result.current.set("abc", { coalesce: true }));
    clock.t += COALESCE_MS - 1;
    act(() => result.current.set("abcd", { coalesce: true }));
    expect(result.current.value).toBe("abcd");
    act(() => result.current.undo());
    expect(result.current.value).toBe("a");
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.redo());
    expect(result.current.value).toBe("abcd");
  });

  it("a coalescing set exactly at the window edge starts a new entry", () => {
    const { result, clock } = setup("a");
    act(() => result.current.set("ab", { coalesce: true }));
    clock.t += COALESCE_MS;
    act(() => result.current.set("abc", { coalesce: true }));
    act(() => result.current.undo());
    expect(result.current.value).toBe("ab");
    act(() => result.current.undo());
    expect(result.current.value).toBe("a");
  });

  it("the first coalescing set and one after a plain set push entries", () => {
    const { result } = setup("a");
    act(() => result.current.set("b"));
    // Same instant, but the previous set was not coalescing.
    act(() => result.current.set("bc", { coalesce: true }));
    act(() => result.current.undo());
    expect(result.current.value).toBe("b");
    act(() => result.current.undo());
    expect(result.current.value).toBe("a");
  });

  it("a plain set ends the coalescing run", () => {
    const { result } = setup("a");
    act(() => result.current.set("ab", { coalesce: true }));
    act(() => result.current.set("X"));
    act(() => result.current.set("Xy", { coalesce: true }));
    act(() => result.current.undo());
    expect(result.current.value).toBe("X");
    act(() => result.current.undo());
    expect(result.current.value).toBe("ab");
    act(() => result.current.undo());
    expect(result.current.value).toBe("a");
  });

  it("undo ends the coalescing run", () => {
    const { result } = setup("a");
    act(() => result.current.set("b"));
    act(() => result.current.set("bc", { coalesce: true }));
    act(() => result.current.undo());
    expect(result.current.value).toBe("b");
    // Still inside the window: without the reset this would replace "b" in place.
    act(() => result.current.set("bd", { coalesce: true }));
    act(() => result.current.undo());
    expect(result.current.value).toBe("b");
    act(() => result.current.undo());
    expect(result.current.value).toBe("a");
  });

  it("redo ends the coalescing run", () => {
    const { result } = setup("a");
    act(() => result.current.set("ab", { coalesce: true }));
    act(() => result.current.undo());
    act(() => result.current.redo());
    expect(result.current.value).toBe("ab");
    act(() => result.current.set("abc", { coalesce: true }));
    act(() => result.current.undo());
    expect(result.current.value).toBe("ab");
  });

  it("a coalesced run that returns to its start leaves no undo step", () => {
    const { result } = setup("a");
    act(() => result.current.set("b"));
    act(() => result.current.set("bc", { coalesce: true }));
    act(() => result.current.set("bcd", { coalesce: true }));
    act(() => result.current.set("bc", { coalesce: true }));
    // Still inside the run: its entry is kept until the start value returns.
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.set("b", { coalesce: true }));
    expect(result.current.value).toBe("b");
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
    act(() => result.current.undo());
    expect(result.current.value).toBe("a");
    expect(result.current.canUndo).toBe(false);
  });

  it("a coalesced run from a fresh history back to its start cannot be undone", () => {
    const { result } = setup("a");
    act(() => result.current.set("ab", { coalesce: true }));
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.set("a", { coalesce: true }));
    expect(result.current.value).toBe("a");
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("typing on after a run returned to its start keeps that value undoable", () => {
    const { result } = setup("a");
    act(() => result.current.set("b"));
    act(() => result.current.set("bc", { coalesce: true }));
    act(() => result.current.set("b", { coalesce: true }));
    // Same instant, inside the window: the dropped run must not be joined.
    act(() => result.current.set("bd", { coalesce: true }));
    expect(result.current.value).toBe("bd");
    act(() => result.current.undo());
    expect(result.current.value).toBe("b");
    act(() => result.current.undo());
    expect(result.current.value).toBe("a");
    expect(result.current.canUndo).toBe(false);
  });

  it("a plain set back to the value beneath a run keeps its entry", () => {
    const { result } = setup("a");
    act(() => result.current.set("ab", { coalesce: true }));
    act(() => result.current.set("a"));
    act(() => result.current.undo());
    expect(result.current.value).toBe("ab");
    act(() => result.current.undo());
    expect(result.current.value).toBe("a");
  });

  it("a coalescing set back to the previous entry outside the window keeps its entry", () => {
    const { result, clock } = setup("a");
    act(() => result.current.set("ab", { coalesce: true }));
    clock.t += COALESCE_MS;
    act(() => result.current.set("a", { coalesce: true }));
    act(() => result.current.undo());
    expect(result.current.value).toBe("ab");
    act(() => result.current.undo());
    expect(result.current.value).toBe("a");
  });

  it("keeps at most HISTORY_LIMIT undo entries, dropping the oldest", () => {
    const { result } = setup("v0");
    act(() => {
      for (let i = 1; i <= HISTORY_LIMIT + 5; i += 1)
        result.current.set(`v${i}`);
    });
    expect(result.current.value).toBe(`v${HISTORY_LIMIT + 5}`);
    let steps = 0;
    while (result.current.canUndo) {
      act(() => result.current.undo());
      steps += 1;
      if (steps > HISTORY_LIMIT + 10) break;
    }
    expect(steps).toBe(HISTORY_LIMIT);
    expect(result.current.value).toBe("v5");
  });

  it("set, undo and redo are referentially stable across renders", () => {
    const { result, rerender } = setup("a");
    const first = result.current;
    act(() => result.current.set("b"));
    rerender();
    act(() => result.current.undo());
    expect(result.current.value).toBe("a");
    expect(result.current.set).toBe(first.set);
    expect(result.current.undo).toBe(first.undo);
    expect(result.current.redo).toBe(first.redo);
  });

  it("stays stable and reads the latest clock when `now` changes", () => {
    let t = 0;
    const hook = renderHook(
      ({ now }: { now: () => number }) => useHistory("a", now),
      { initialProps: { now: () => t } },
    );
    const { set } = hook.result.current;
    act(() => hook.result.current.set("ab", { coalesce: true }));
    t = 10;
    hook.rerender({ now: () => t + COALESCE_MS });
    expect(hook.result.current.set).toBe(set);
    // The new clock reads 510: outside the window, so a new entry is pushed.
    act(() => hook.result.current.set("abc", { coalesce: true }));
    act(() => hook.result.current.undo());
    expect(hook.result.current.value).toBe("ab");
  });

  it("defaults to the real clock", () => {
    const { result } = renderHook(() => useHistory("a"));
    act(() => result.current.set("ab", { coalesce: true }));
    act(() => result.current.set("abc", { coalesce: true }));
    act(() => result.current.undo());
    expect(result.current.value).toBe("a");
  });
});

describe("historyReducer", () => {
  it("is pure: it returns new state and leaves the input untouched", () => {
    const start = initialHistory("a");
    const frozen = Object.freeze({ ...start, past: Object.freeze([]) });
    const next = historyReducer(frozen, {
      type: "set",
      next: "b",
      coalesce: false,
      at: 0,
    });
    expect(next).toEqual({
      past: ["a"],
      value: "b",
      future: [],
      coalescedAt: undefined,
    });
    expect(frozen).toEqual(start);
  });

  it("returns the same state object for no-op actions", () => {
    const start = initialHistory("a");
    expect(historyReducer(start, { type: "undo" })).toBe(start);
    expect(historyReducer(start, { type: "redo" })).toBe(start);
    expect(
      historyReducer(start, { type: "set", next: "a", coalesce: true, at: 5 }),
    ).toBe(start);
  });

  it("a run that returns to its start drops its entry, ends the run and restores no redo", () => {
    const next = historyReducer(
      { past: ["a", "b"], value: "bc", future: [], coalescedAt: 100 },
      { type: "set", next: "b", coalesce: true, at: 100 + COALESCE_MS - 1 },
    );
    expect(next).toEqual({
      past: ["a"],
      value: "b",
      future: [],
      coalescedAt: undefined,
    });
  });

  it("redo keeps the undo stack within the limit", () => {
    const past = Array.from({ length: HISTORY_LIMIT }, (_, i) => `p${i}`);
    const next = historyReducer(
      { past, value: "now", future: ["later"], coalescedAt: undefined },
      { type: "redo" },
    );
    expect(next.past).toHaveLength(HISTORY_LIMIT);
    expect(next.past[0]).toBe("p1");
    expect(next.past.at(-1)).toBe("now");
    expect(next.value).toBe("later");
  });
});
