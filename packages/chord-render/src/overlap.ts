import { useLayoutEffect, useState, type RefObject } from "react";

/** One chord box on a visual row, in logical inline-axis px from the inline-start edge. */
export interface InlineSpan {
  start: number;
  end: number;
}

/**
 * Pure B4 math. `boxes` are one visual row's chord boxes in LOGICAL order.
 * Returns per-chord padding (px, >= 0, out[0] === 0) to add before chord i so
 * its start is >= every earlier chord's shifted end + gap. Padding before chord
 * i also shifts every later chord, so shifts accumulate.
 */
export function computeOverlapPadding(
  boxes: readonly InlineSpan[],
  gap = 4,
): number[] {
  const out: number[] = [];
  let shift = 0;
  let maxEnd = Number.NEGATIVE_INFINITY;
  boxes.forEach((box, i) => {
    let pad = 0;
    if (i > 0) pad = Math.max(0, maxEnd + gap - (box.start + shift));
    shift += pad;
    maxEnd = Math.max(maxEnd, box.end + shift);
    out.push(pad);
  });
  return out;
}

const MAX_ITERATIONS = 8;
const ROW_TOLERANCE = 1;
const GAP = 4;

/** A chord box's PHYSICAL x-interval (viewport px); DOM order is the array order. */
interface Measured {
  anchor: HTMLElement;
  left: number;
  right: number;
}

/** Chord boxes grouped into visual rows (top within tolerance), each in DOM order. */
function measureLine(line: HTMLElement): Measured[][] {
  const rows: { top: number; items: Measured[] }[] = [];
  for (const box of line.querySelectorAll<HTMLElement>("[data-chord-box]")) {
    const anchor = box.parentElement;
    if (!anchor) continue;
    const r = box.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue; // not laid out
    const item: Measured = { anchor, left: r.left, right: r.right };
    const row = rows.find((x) => Math.abs(x.top - r.top) <= ROW_TOLERANCE);
    if (row) row.items.push(item);
    else rows.push({ top: r.top, items: [item] });
  }
  return rows.map((r) => r.items);
}

/**
 * Padding needed to separate `later` from `earlier`: the actual physical
 * overlap plus the gap, measured on the side where `later` lies. 0 when the
 * intervals are already further apart than the gap.
 */
function pairPadding(earlier: Measured, later: Measured): number {
  const collides =
    earlier.left < later.right + GAP && later.left < earlier.right + GAP;
  if (!collides) return 0;
  const laterIsRight = later.left + later.right >= earlier.left + earlier.right;
  return laterIsRight
    ? earlier.right + GAP - later.left
    : later.right + GAP - earlier.left;
}

/** Per-chord padding for one physical row in DOM order; shifts cascade. */
function rowPadding(row: readonly Measured[]): number[] {
  const cum: number[] = [];
  const out: number[] = [];
  row.forEach((later, i) => {
    let pad = 0;
    for (let j = 0; j < i; j++) {
      const applied = (cum[i - 1] ?? 0) - (cum[j] ?? 0);
      pad = Math.max(pad, pairPadding(row[j]!, later) - applied);
    }
    out.push(pad);
    cum.push((cum[i - 1] ?? 0) + pad);
  });
  return out;
}

/** Measures all lyric lines and pads; `padded` tracks elements we touched. */
export function runOverlapPass(
  root: HTMLElement,
  padded: Set<HTMLElement>,
): void {
  for (const el of padded) el.style.removeProperty("padding-inline-end");
  padded.clear();
  const lines = root.querySelectorAll<HTMLElement>('[data-line="lyric"]');
  for (const line of lines) {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      let changed = false;
      for (const row of measureLine(line)) {
        const pads = rowPadding(row);
        row.forEach((m, i) => {
          const pad = pads[i] ?? 0;
          const target = m.anchor.previousElementSibling;
          if (pad <= 0 || !(target instanceof HTMLElement)) return;
          const current = padded.has(target)
            ? parseFloat(target.style.getPropertyValue("padding-inline-end")) ||
              0
            : 0;
          target.style.setProperty("padding-inline-end", `${current + pad}px`);
          padded.add(target);
          changed = true;
        });
      }
      if (!changed) break;
    }
  }
}

function inlineSize(root: HTMLElement): number {
  return root.getBoundingClientRect().width;
}

/**
 * B4: runs the overlap pass after layout, and again on root inline-size change,
 * font loading and `document.fonts.ready`. Returns the completed-pass count.
 */
export function useChordOverlap(
  rootRef: RefObject<HTMLElement | null>,
  dep: unknown,
): number {
  const [pass, setPass] = useState(0);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let cancelled = false;
    let lastSize = Number.NaN;
    const padded = new Set<HTMLElement>();
    const run = () => {
      if (cancelled) return;
      runOverlapPass(root, padded);
      lastSize = inlineSize(root);
      setPass((p) => p + 1);
    };
    run();

    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        if (inlineSize(root) !== lastSize) run();
      });
      ro.observe(root);
    }
    const fonts: FontFaceSet | undefined =
      typeof document !== "undefined"
        ? (document as Document & { fonts?: FontFaceSet }).fonts
        : undefined;
    fonts?.addEventListener?.("loadingdone", run);
    void fonts?.ready?.then(run);

    return () => {
      cancelled = true;
      for (const el of padded) el.style.removeProperty("padding-inline-end");
      ro?.disconnect();
      fonts?.removeEventListener?.("loadingdone", run);
    };
  }, [rootRef, dep]);
  return pass;
}
