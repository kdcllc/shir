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
  /** The previous sibling lies on the far side of the anchor from the line start. */
  prevOnWrongSide: boolean;
}

/**
 * True when the anchor's previous sibling (its logical end) lies on the same visual row but
 * on the far side of the anchor from the line start, i.e. the anchor sits in an embedded
 * opposite-direction run. Read with the box measurements, before any padding is written.
 */
function prevOnWrongSide(anchor: HTMLElement): boolean {
  const prev = anchor.previousElementSibling;
  const p = prev ? [...prev.getClientRects()].pop() : undefined;
  const l = anchor.getClientRects()[0];
  if (!p || !l) return false;
  if (p.top >= l.bottom || l.top >= p.bottom) return false; // different rows
  const rtl = getComputedStyle(anchor).direction === "rtl";
  const dx = p.left + p.right - (l.left + l.right);
  return rtl ? dx < 0 : dx > 0;
}

/** Chord boxes grouped into visual rows (top within tolerance), each in DOM order. */
function measureLine(line: HTMLElement): Measured[][] {
  const rows: { top: number; items: Measured[] }[] = [];
  for (const box of line.querySelectorAll<HTMLElement>("[data-chord-box]")) {
    const anchor = box.parentElement;
    if (!anchor) continue;
    const r = box.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue; // not laid out
    const item: Measured = {
      anchor,
      left: r.left,
      right: r.right,
      prevOnWrongSide: prevOnWrongSide(anchor),
    };
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
function rowPadding(row: readonly Measured[]): {
  pad: number;
  against: number;
}[] {
  const cum: number[] = [];
  const out: { pad: number; against: number }[] = [];
  row.forEach((later, i) => {
    let pad = 0;
    let against = Math.max(i - 1, 0);
    for (let j = 0; j < i; j++) {
      const applied = (cum[i - 1] ?? 0) - (cum[j] ?? 0);
      const need = pairPadding(row[j]!, later) - applied;
      if (need > pad) {
        pad = need;
        against = j;
      }
    }
    out.push({ pad, against });
    cum.push((cum[i - 1] ?? 0) + pad);
  });
  return out;
}

/** The chord box of an anchor. */
function boxOf(anchor: HTMLElement): HTMLElement | null {
  return anchor.querySelector<HTMLElement>("[data-chord-box]");
}

/** Physical distance between two anchors' chord boxes; negative when they overlap. */
function boxGap(a: HTMLElement, b: HTMLElement): number {
  const ra = boxOf(a)?.getBoundingClientRect();
  const rb = boxOf(b)?.getBoundingClientRect();
  if (!ra || !rb) return Number.POSITIVE_INFINITY;
  return Math.max(rb.left - ra.right, ra.left - rb.right);
}

function addPadding(el: HTMLElement, px: number, padded: Set<HTMLElement>) {
  const current = padded.has(el)
    ? parseFloat(el.style.getPropertyValue("padding-inline-end")) || 0
    : 0;
  el.style.setProperty("padding-inline-end", `${current + px}px`);
  padded.add(el);
}

function removePadding(el: HTMLElement, px: number, padded: Set<HTMLElement>) {
  const current =
    parseFloat(el.style.getPropertyValue("padding-inline-end")) || 0;
  if (current - px > 0) {
    el.style.setProperty("padding-inline-end", `${current - px}px`);
  } else {
    el.style.removeProperty("padding-inline-end");
    padded.delete(el);
  }
}

/**
 * Elements whose end-padding can separate `earlier` from `later`, nearest to `later` first:
 * the previous sibling of `later`, then every element back to `earlier`'s own anchor.
 * `padding-inline-end` is applied at the LOGICAL end of an element, so inside an embedded
 * opposite-direction run the previous sibling's padding lands on the wrong side of `later`
 * (it moves the text before `later`, not `later`); the elements before the run work instead.
 */
function candidates(earlier: HTMLElement, later: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (
    let el = later.previousElementSibling;
    el instanceof HTMLElement;
    el = el.previousElementSibling
  ) {
    out.push(el);
    if (el === earlier) break;
  }
  return out;
}

/**
 * Pads for the pair. Normally that is the previous sibling of `later`; when it lies on the
 * far side of `later` (`wrongSide`: embedded opposite-direction run) its padding cannot move `later`
 * away from `earlier`, so the elements before it are tried, keeping the first one that
 * measurably widens the gap.
 */
function padPair(
  earlier: HTMLElement,
  later: HTMLElement,
  wrongSide: boolean,
  pad: number,
  padded: Set<HTMLElement>,
): boolean {
  const list = candidates(earlier, later);
  const first = list[0];
  if (!first) return false;
  if (!wrongSide) {
    addPadding(first, pad, padded);
    return true;
  }
  const before = boxGap(earlier, later);
  for (const el of list) {
    const had = padded.has(el);
    addPadding(el, pad, padded);
    if (boxGap(earlier, later) - before >= pad / 2) return true;
    if (had) removePadding(el, pad, padded);
    else {
      el.style.removeProperty("padding-inline-end");
      padded.delete(el);
    }
  }
  // Nothing measurably helped: keep the nearest candidate.
  addPadding(first, pad, padded);
  return true;
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
          const { pad, against } = pads[i] ?? { pad: 0, against: 0 };
          const earlier = row[against];
          if (pad <= 0 || !earlier) return;
          if (padPair(earlier.anchor, m.anchor, m.prevOnWrongSide, pad, padded))
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
