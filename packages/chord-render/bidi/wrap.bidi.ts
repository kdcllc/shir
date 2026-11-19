import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { FixtureName } from "test-fixtures";
import { open } from "./helpers";

// F4 (Q&A 21): editing mode must wrap exactly like read-only rendering. Rows are counted
// from the grapheme text only (text nodes outside `[data-chord-box]`). The editing-mode end
// slot IS a separate trailing element (the last child of the line, `[data-end-slot]`, holding
// no text), so it is excluded from the comparison: it is asserted to be that, and its
// `padding-inline-end` (an editing-only click affordance that can push the last word to the
// next row by up to 0.75em) is zeroed in the editing run.

const WIDTHS = [280, 320, 360, 420, 480] as const;
const START = 600;
const FLOOR = 120;

/** Visual row count of every lyric line at each width, in the order of `widths`. */
async function rowsAt(
  page: Page,
  widths: readonly number[],
): Promise<number[][]> {
  return page.evaluate(async (ws) => {
    const song = document.querySelector<HTMLElement>("[data-song]");
    if (!song) throw new Error("no song");
    const pass = () => Number(song.getAttribute("data-overlap-pass") ?? "0");
    const settle = (px: number) =>
      new Promise<void>((resolve) => {
        const before = pass();
        window.__setWidth?.(px);
        const done = () => {
          mo.disconnect();
          clearTimeout(timer);
          resolve();
        };
        const mo = new MutationObserver(() => {
          if (pass() > before) done();
        });
        mo.observe(song, {
          attributes: true,
          attributeFilter: ["data-overlap-pass"],
        });
        const timer = setTimeout(done, 300);
      });
    const rowsOf = (line: Element): number => {
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) =>
          n.parentElement?.closest("[data-chord-box]")
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
      });
      const tops: number[] = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const node = n as Text;
        for (let i = 0; i < node.length; i++) {
          const range = document.createRange();
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const r = range.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          // Rows are at least a line apart; 10px absorbs per-font ascent differences.
          if (!tops.some((t) => Math.abs(t - r.top) <= 10)) tops.push(r.top);
        }
      }
      return tops.length;
    };
    const out: number[][] = [];
    for (const w of ws) {
      await settle(w);
      out.push(
        [...document.querySelectorAll('[data-line="lyric"]')].map(rowsOf),
      );
    }
    return out;
  }, widths);
}

/**
 * For each lyric line, the first width found by stepping down 1px from `START` at which
 * its read-only row count exceeds the count at `START` (null when it never does).
 */
async function boundaries(page: Page): Promise<(number | null)[]> {
  const widths = Array.from({ length: START - FLOOR + 1 }, (_, i) => START - i);
  const all = await rowsAt(page, widths);
  const first = all[0] ?? [];
  return first.map((base, line) => {
    const hit = all.findIndex((rows) => (rows[line] ?? 0) > base);
    return hit < 0 ? null : (widths[hit] ?? null);
  });
}

for (const name of [
  "long_wrap_line",
  "he_niqqud",
] as const satisfies readonly FixtureName[]) {
  test(`F4 editing mode wraps like read-only: ${name}`, async ({ page }) => {
    await open(page, name, { width: START });
    const found = await boundaries(page);
    const lineBoundaries = found.flatMap((b, line) =>
      b === null ? [] : [{ line, width: b }],
    );
    // Precondition: at least one line of the fixture actually wraps below START.
    expect(lineBoundaries.length).toBeGreaterThan(0);
    const widths = [
      ...WIDTHS,
      ...lineBoundaries.flatMap((b) => [b.width, b.width + 1]),
    ].sort((a, b) => b - a);

    await open(page, name, { width: START });
    const readOnly = await rowsAt(page, widths);
    await open(page, name, { width: START, editing: true });
    expect(
      await page.locator('[data-line="lyric"][data-editing]').count(),
    ).toBe(await page.locator('[data-line="lyric"]').count());
    const slots = await page.evaluate(() =>
      [...document.querySelectorAll('[data-line="lyric"]')].map((line) => {
        const slot = line.querySelector("[data-end-slot]");
        return {
          last: slot !== null && line.lastElementChild === slot,
          empty: slot?.textContent === "",
        };
      }),
    );
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) expect(s).toEqual({ last: true, empty: true });
    await page.addStyleTag({
      content: "[data-end-slot] { padding-inline-end: 0 !important; }",
    });
    const editing = await rowsAt(page, widths);
    widths.forEach((w, i) => {
      expect(editing[i], `${name} rows per lyric line @${w}px`).toEqual(
        readOnly[i],
      );
    });
    // Precondition: wrapping really differs across the compared widths.
    expect(new Set(readOnly.map((r) => r.join(","))).size).toBeGreaterThan(1);
  });
}
