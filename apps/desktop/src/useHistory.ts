import { useCallback, useEffect, useReducer, useRef } from "react";

/** Most entries the undo stack keeps; the oldest is dropped beyond it. */
export const HISTORY_LIMIT = 200;

/** A coalescing `set` joins the previous one when it follows it by less than this. */
export const COALESCE_MS = 500;

export interface HistoryState {
  /** Undo stack, oldest entry first. */
  past: readonly string[];
  value: string;
  /** Redo stack; the next value to redo is last. */
  future: readonly string[];
  /** Time of the last coalescing `set`; `undefined` when no coalescing run is open. */
  coalescedAt: number | undefined;
}

export type HistoryAction =
  | { type: "set"; next: string; coalesce: boolean; at: number }
  | { type: "undo" }
  | { type: "redo" };

/** The state of a fresh history holding `initial`. */
export function initialHistory(initial: string): HistoryState {
  return { past: [], value: initial, future: [], coalescedAt: undefined };
}

function pushed(past: readonly string[], value: string): string[] {
  return [...past, value].slice(-HISTORY_LIMIT);
}

/** Pure undo/redo reducer; time enters only through `action.at`. */
export function historyReducer(
  state: HistoryState,
  action: HistoryAction,
): HistoryState {
  switch (action.type) {
    case "set": {
      if (action.next === state.value) return state;
      const joins =
        action.coalesce &&
        state.coalescedAt !== undefined &&
        action.at - state.coalescedAt < COALESCE_MS;
      // The run came back to the value it started from: its entry would be
      // an undo step that changes nothing, so it is dropped and the run ends.
      if (joins && state.past.at(-1) === action.next) {
        return {
          past: state.past.slice(0, -1),
          value: action.next,
          future: [],
          coalescedAt: undefined,
        };
      }
      return {
        past: joins ? state.past : pushed(state.past, state.value),
        value: action.next,
        future: [],
        coalescedAt: action.coalesce ? action.at : undefined,
      };
    }
    case "undo": {
      const previous = state.past.at(-1);
      if (previous === undefined) return state;
      return {
        past: state.past.slice(0, -1),
        value: previous,
        future: [...state.future, state.value],
        coalescedAt: undefined,
      };
    }
    case "redo": {
      const next = state.future.at(-1);
      if (next === undefined) return state;
      return {
        past: pushed(state.past, state.value),
        value: next,
        future: state.future.slice(0, -1),
        coalescedAt: undefined,
      };
    }
  }
}

export interface History {
  value: string;
  canUndo: boolean;
  canRedo: boolean;
  /** Records `next` as a new entry. `coalesce` defaults to false. */
  set(next: string, options?: { coalesce?: boolean | undefined }): void;
  undo(): void;
  redo(): void;
}

/** Undo/redo history of one text value. `now` is injectable for tests. */
export function useHistory(
  initial: string,
  now: () => number = Date.now,
): History {
  const [state, dispatch] = useReducer(historyReducer, initial, initialHistory);
  const clock = useRef(now);
  useEffect(() => {
    clock.current = now;
  }, [now]);

  const set = useCallback(
    (next: string, options?: { coalesce?: boolean | undefined }) => {
      dispatch({
        type: "set",
        next,
        coalesce: options?.coalesce === true,
        at: clock.current(),
      });
    },
    [],
  );
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);

  return {
    value: state.value,
    canUndo: state.past.length !== 0,
    canRedo: state.future.length !== 0,
    set,
    undo,
    redo,
  };
}
