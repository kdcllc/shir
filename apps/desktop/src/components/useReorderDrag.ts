import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export interface ReorderHandleProps {
  onPointerDown(e: ReactPointerEvent<HTMLElement>): void;
  onPointerMove(e: ReactPointerEvent<HTMLElement>): void;
  onPointerUp(): void;
  onPointerCancel(): void;
}

export interface ReorderDrag {
  /** Id of the row being dragged, `null` while idle. */
  draggingId: string | null;
  /** Index the dragged row would land at in the new order, `null` while idle. */
  targetIndex: number | null;
  /** Ref callback of a row element; the hook measures rows through it. */
  registerRow(id: string, el: HTMLElement | null): void;
  /** The registered element of row `id`. */
  rowElement(id: string): HTMLElement | undefined;
  /** Pointer handlers for the drag handle of row `id`. */
  handleProps(id: string): ReorderHandleProps;
}

interface Session {
  id: string;
  pointerId: number;
  handle: HTMLElement;
  target: number;
}

/**
 * Pointer-event drag reorder (no HTML5 drag API). Pointerdown on a handle captures the pointer;
 * the target index is the number of the other rows whose block-axis midpoint is above the
 * pointer, so it does not depend on the inline direction. Pointerup calls `onReorder` with the
 * full new id order (and the moved id), only when it changed; `Escape` or `pointercancel` aborts without a call.
 */
export function useReorderDrag(
  ids: readonly string[],
  onReorder: (ids: string[], movedId: string) => void,
): ReorderDrag {
  const rows = useRef(new Map<string, HTMLElement>());
  const session = useRef<Session | null>(null);
  const [view, setView] = useState<{ id: string; target: number } | null>(null);

  const registerRow = useCallback((id: string, el: HTMLElement | null) => {
    if (el) rows.current.set(id, el);
    else rows.current.delete(id);
  }, []);

  const rowElement = useCallback((id: string) => rows.current.get(id), []);

  const targetFor = (id: string, clientY: number): number => {
    let target = 0;
    for (const other of ids) {
      if (other === id) continue;
      const rect = rows.current.get(other)?.getBoundingClientRect();
      if (rect && clientY > rect.top + rect.height / 2) target += 1;
    }
    return target;
  };

  const end = useCallback((): void => {
    const current = session.current;
    session.current = null;
    setView(null);
    if (current) {
      try {
        current.handle.releasePointerCapture?.(current.pointerId);
      } catch {
        // The pointer may already be gone.
      }
    }
  }, []);

  const dragging = view !== null;
  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") end();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dragging, end]);

  const handleProps = (id: string): ReorderHandleProps => ({
    onPointerDown(e) {
      if (e.button !== 0 || session.current) return;
      const handle = e.currentTarget;
      handle.setPointerCapture?.(e.pointerId);
      const target = ids.indexOf(id);
      session.current = { id, pointerId: e.pointerId, handle, target };
      setView({ id, target });
    },
    onPointerMove(e) {
      const current = session.current;
      if (!current || current.id !== id) return;
      const target = targetFor(id, e.clientY);
      if (target === current.target) return;
      current.target = target;
      setView({ id, target });
    },
    onPointerUp() {
      const current = session.current;
      if (!current || current.id !== id) return;
      end();
      const others = ids.filter((other) => other !== id);
      const next = [
        ...others.slice(0, current.target),
        id,
        ...others.slice(current.target),
      ];
      if (next.some((value, i) => value !== ids[i])) onReorder(next, id);
    },
    onPointerCancel() {
      if (session.current?.id === id) end();
    },
  });

  return {
    draggingId: view?.id ?? null,
    targetIndex: view?.target ?? null,
    registerRow,
    rowElement,
    handleProps,
  };
}
