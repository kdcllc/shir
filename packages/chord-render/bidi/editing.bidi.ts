import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { splitGraphemes } from "chord-core";
import type { LyricLine, SongModel } from "chord-core";
import type { FixtureName } from "test-fixtures";
import {
  anchorEdgeErrors,
  chordTexts,
  fontsInUse,
  golden,
  goldenChords,
  groupRows,
  measure,
  overlapCount,
  overlapPass,
  renderedLines,
} from "./helpers";
import type { Rect } from "./helpers";

const EDITING_FIXTURES = [
  "he_plain",
  "he_niqqud",
  "mixed_he_en",
  "en_plain",
] as const satisfies readonly FixtureName[];

/**
 * Opens the harness in editing mode. `helpers.open` cannot add `editing=1`,
 * so the spec builds the URL itself and waits for the same ready signal.
 */
async function openEditing(
  page: Page,
  fixture: FixtureName,
  width?: number,
): Promise<void> {
  const q = new URLSearchParams({ fixture, editing: "1" });
  if (width !== undefined) q.set("width", String(width));
  await page.goto(`/?${q.toString()}`);
  await page.waitForSelector('body[data-ready="1"]');
  // R5: the bundled fonts are really in use.
  expect(await fontsInUse(page)).toBe(true);
  // Precondition: every lyric line is interactive, none is read-only.
  const lyric = page.locator('[data-line="lyric"]');
  expect(await lyric.count()).toBeGreaterThan(0);
  expect(await page.locator('[data-line="lyric"][data-editing]').count()).toBe(
    await lyric.count(),
  );
}

interface LyricRef {
  /** Index among the `[data-line]` elements of the page. */
  dom: number;
  /** Index in `song.lines`, the `line` the harness reports. */
  model: number;
  line: LyricLine;
  graphemes: string[];
}

/** The lyric lines of a golden song with both of their indices. */
function lyricRefs(song: SongModel): LyricRef[] {
  const rendered = renderedLines(song);
  return song.lines.flatMap((line, model) =>
    line.kind === "lyric"
      ? [
          {
            dom: rendered.indexOf(line),
            model,
            line,
            graphemes: splitGraphemes(line.lyric),
          },
        ]
      : [],
  );
}

interface PosMeasure {
  pos: number;
  end: boolean;
  /** Own text of the position element, without its chord box. */
  text: string;
  /** Box of the grapheme text; of the element itself for the end slot. */
  rect: Rect;
}

/** Every `[data-pos]` element of the `dom`-th `[data-line]`, in DOM order. */
async function positions(page: Page, dom: number): Promise<PosMeasure[]> {
  return page.evaluate((idx) => {
    const line = document.querySelectorAll<HTMLElement>("[data-line]")[idx];
    if (!line) throw new Error(`no line ${idx}`);
    const toRect = (r: DOMRect) => ({
      xMin: r.left,
      xMax: r.right,
      yMin: r.top,
      yMax: r.bottom,
    });
    return [...line.querySelectorAll<HTMLElement>("[data-pos]")].map((el) => {
      const texts = [...el.childNodes].filter(
        (n): n is Text => n.nodeType === Node.TEXT_NODE,
      );
      const text = texts.map((n) => n.data).join("");
      let rect = el.getBoundingClientRect();
      const [only] = texts;
      if (texts.length === 1 && only !== undefined && only.length > 0) {
        const range = document.createRange();
        range.selectNodeContents(only);
        rect = range.getBoundingClientRect();
      }
      return {
        pos: Number(el.getAttribute("data-pos")),
        end: el.hasAttribute("data-end-slot"),
        text,
        rect: toRect(rect),
      };
    });
  }, dom);
}

const centre = (r: Rect): { x: number; y: number } => ({
  x: (r.xMin + r.xMax) / 2,
  y: (r.yMin + r.yMax) / 2,
});

async function lastEdit(page: Page): Promise<unknown> {
  return page.evaluate(() => window.__lastEdit ?? null);
}

async function clearLastEdit(page: Page): Promise<void> {
  await page.evaluate(() => {
    delete window.__lastEdit;
  });
}

/** The single visual row of a line's graphemes; fails when the line wraps. */
function singleRow(all: PosMeasure[], what: string): PosMeasure[] {
  const graphemes = all.filter((p) => !p.end);
  expect(groupRows(graphemes).length, `${what} is one visual line`).toBe(1);
  return graphemes;
}

test.describe("editing checklist 1-3", () => {
  for (const name of EDITING_FIXTURES) {
    test(`editing checklist 1 chord text equality ${name}`, async ({
      page,
    }) => {
      await openEditing(page, name);
      const song = golden(name);
      expect(await chordTexts(page)).toEqual(goldenChords(song));
      // Every chord of a lyric line is a button that names its anchor.
      const buttons = await page.evaluate(() =>
        [...document.querySelectorAll("[data-line]")].map((line) =>
          [...line.querySelectorAll("[data-chord-button]")].map((b) => ({
            text: b.textContent ?? "",
            anchor: Number(b.getAttribute("data-anchor-index")),
          })),
        ),
      );
      for (const ref of lyricRefs(song)) {
        expect(buttons[ref.dom], `${name} line ${ref.model}`).toEqual(
          ref.line.chords.map((c, anchor) => ({ text: c.chord, anchor })),
        );
      }
    });

    test(`editing checklist 2 anchor edge <= 2px ${name}`, async ({ page }) => {
      await openEditing(page, name, 720);
      const song = golden(name);
      const errors = anchorEdgeErrors(song, await measure(page, song));
      expect(errors.length).toBeGreaterThan(0);
      for (const e of errors) {
        expect(
          e.error,
          `${name} line ${e.line} index ${e.index}`,
        ).toBeLessThanOrEqual(2);
      }
    });

    test(`editing checklist 2 chords sit above their grapheme ${name}`, async ({
      page,
    }) => {
      await openEditing(page, name, 720);
      const song = golden(name);
      const lines = await measure(page, song);
      let boxes = 0;
      for (const lm of lines) {
        for (const box of lm.boxes) {
          const g = lm.graphemes[Math.min(box.index, lm.graphemes.length - 1)];
          if (!g) continue;
          boxes++;
          expect(
            box.rect.yMax,
            `${name} box @${box.index}`,
          ).toBeLessThanOrEqual(g.rect.yMin + 2);
          expect(
            box.rect.yMax,
            `${name} box @${box.index}`,
          ).toBeGreaterThanOrEqual(g.rect.yMin - lm.lineHeight);
        }
      }
      expect(boxes).toBe(
        new Set(
          lyricRefs(song).flatMap((ref) =>
            ref.line.chords.map((c) => `${ref.model}:${c.index}`),
          ),
        ).size,
      );
    });

    for (const width of [360, 720]) {
      test(`editing checklist 3 no overlap ${name} @${width}`, async ({
        page,
      }) => {
        await openEditing(page, name, width);
        expect(await overlapPass(page)).toBeGreaterThanOrEqual(1);
        const lines = await measure(page, golden(name));
        expect(lines.flatMap((l) => l.boxes).length).toBeGreaterThan(0);
        expect(overlapCount(lines)).toBe(0);
      });
    }
  }
});

// The fixtures above have no close chords, so their checklist-3 tests pass
// without the overlap pass. `dense_chords` has a chord on every syllable: its
// chord boxes intersect unless the pass pads them apart.
test("editing checklist 3 no overlap dense_chords @360 depends on the overlap pass", async ({
  page,
}) => {
  await openEditing(page, "dense_chords", 360);
  await expect.poll(() => overlapPass(page)).toBeGreaterThanOrEqual(1);
  // Precondition: the pass had to pad positions of the editing-mode lyric line.
  const padded = await page.evaluate(
    () =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '[data-line="lyric"][data-editing] [data-pos]',
        ),
      ].filter(
        (el) => parseFloat(el.style.getPropertyValue("padding-inline-end")) > 0,
      ).length,
  );
  expect(padded, "positions padded by the overlap pass").toBeGreaterThan(0);
  const lines = await measure(page, golden("dense_chords"));
  expect(lines.flatMap((l) => l.boxes).length).toBe(10);
  expect(overlapCount(lines)).toBe(0);
});

test.describe("editing checklist 4 position order", () => {
  test("he_plain: position 0 is the rightmost position of the first lyric line", async ({
    page,
  }) => {
    await openEditing(page, "he_plain");
    const [first] = lyricRefs(golden("he_plain"));
    if (!first) throw new Error("no lyric line");
    const all = await positions(page, first.dom);
    const row = singleRow(all, "he_plain line 1");
    expect(row.length).toBe(first.graphemes.length);
    const zero = row.find((p) => p.pos === 0);
    if (!zero) throw new Error("no position 0");
    for (const p of row) {
      expect(zero.rect.xMax, `pos ${p.pos}`).toBeGreaterThanOrEqual(
        p.rect.xMax,
      );
    }
    // Strictly right to left: each Hebrew grapheme starts left of the one before.
    for (let i = 1; i < row.length; i++) {
      expect(row[i]!.rect.xMax, `pos ${i}`).toBeLessThanOrEqual(
        row[i - 1]!.rect.xMin + 0.5,
      );
    }
  });

  test("en_plain: position 0 is the leftmost position of the first lyric line", async ({
    page,
  }) => {
    await openEditing(page, "en_plain");
    const [first] = lyricRefs(golden("en_plain"));
    if (!first) throw new Error("no lyric line");
    const all = await positions(page, first.dom);
    const row = singleRow(all, "en_plain line 1");
    expect(row.length).toBe(first.graphemes.length);
    const zero = row.find((p) => p.pos === 0);
    if (!zero) throw new Error("no position 0");
    for (const p of row) {
      expect(zero.rect.xMin, `pos ${p.pos}`).toBeLessThanOrEqual(p.rect.xMin);
    }
    for (let i = 1; i < row.length; i++) {
      expect(row[i]!.rect.xMin, `pos ${i}`).toBeGreaterThanOrEqual(
        row[i - 1]!.rect.xMax - 0.5,
      );
    }
    // The end slot of an LTR line is at the visual right end.
    const end = all.find((p) => p.end);
    if (!end) throw new Error("no end slot");
    expect(end.pos).toBe(first.graphemes.length);
    expect(end.rect.xMin).toBeGreaterThanOrEqual(
      Math.max(...row.map((p) => p.rect.xMax)) - 0.5,
    );
  });

  test("mixed_he_en: the Latin run reads left to right inside the RTL line", async ({
    page,
  }) => {
    await openEditing(page, "mixed_he_en");
    const ref = lyricRefs(golden("mixed_he_en")).find((r) =>
      r.line.lyric.includes("rock and roll"),
    );
    if (!ref) throw new Error("no rock line");
    const start = ref.graphemes.join("").indexOf("rock and roll");
    expect(start).toBe(11);
    const row = singleRow(await positions(page, ref.dom), "the mixed line");
    const latin = row.filter((p) => p.pos >= 11 && p.pos <= 23);
    expect(latin.map((p) => p.text).join("")).toBe("rock and roll");
    for (let i = 1; i < latin.length; i++) {
      expect(latin[i]!.rect.xMin, `pos ${latin[i]!.pos}`).toBeGreaterThan(
        latin[i - 1]!.rect.xMin,
      );
    }
    // The Hebrew before the phrase is to its right, the Hebrew after it to its left.
    const left = Math.min(...latin.map((p) => p.rect.xMin));
    const right = Math.max(...latin.map((p) => p.rect.xMax));
    for (const p of row) {
      if (p.pos < 10)
        expect(p.rect.xMin, `pos ${p.pos}`).toBeGreaterThanOrEqual(right - 0.5);
      if (p.pos > 24)
        expect(p.rect.xMax, `pos ${p.pos}`).toBeLessThanOrEqual(left + 0.5);
    }
  });
});

test("editing visual order of the mixed line matches visualOrder", async ({
  page,
}) => {
  // Default width: the URL carries no width parameter.
  await openEditing(page, "mixed_he_en");
  const ref = lyricRefs(golden("mixed_he_en")).find((r) =>
    r.line.lyric.includes("rock and roll"),
  );
  if (!ref) throw new Error("no rock line");
  expect(ref.graphemes).toHaveLength(33);
  const all = await positions(page, ref.dom);
  const row = singleRow(all, "the mixed line at the default width");
  expect(row.map((p) => p.pos)).toEqual(
    Array.from({ length: 33 }, (_, i) => i),
  );
  const byLeft = [...row].sort((a, b) => a.rect.xMin - b.rect.xMin);
  const range = (from: number, to: number): number[] =>
    Array.from({ length: Math.abs(to - from) + 1 }, (_, i) =>
      from <= to ? from + i : from - i,
    );
  const expected = [...range(32, 24), ...range(11, 23), ...range(10, 0)];
  expect(expected).toHaveLength(33);
  expect(byLeft.map((p) => p.pos)).toEqual(expected);
  // With its end position: 33 first, at the visual left end of the RTL line.
  const end = all.find((p) => p.end);
  if (!end) throw new Error("no end slot");
  expect(end.pos).toBe(33);
  expect(end.rect.xMin).toBeLessThanOrEqual(byLeft[0]!.rect.xMin + 0.5);
});

test.describe("editing clicks hit logical positions", () => {
  test("a click on the centre of position 0 of a Hebrew line reports index 0 of that line", async ({
    page,
  }) => {
    await openEditing(page, "he_plain");
    const refs = lyricRefs(golden("he_plain"));
    expect(refs.length).toBeGreaterThanOrEqual(3);
    // Lines with and without a chord over position 0.
    expect(refs[0]!.line.chords.some((c) => c.index === 0)).toBe(true);
    expect(refs[2]!.line.chords.some((c) => c.index === 0)).toBe(false);
    for (const ref of [refs[0]!, refs[2]!]) {
      await clearLastEdit(page);
      expect(await lastEdit(page)).toBeNull();
      const all = await positions(page, ref.dom);
      const zero = all.find((p) => p.pos === 0);
      if (!zero) throw new Error("no position 0");
      // Position 0 of an RTL line is in the right half of the line.
      const xs = all.filter((p) => !p.end).map((p) => centre(p.rect).x);
      expect(centre(zero.rect).x).toBe(Math.max(...xs));
      const at = centre(zero.rect);
      await page.mouse.click(at.x, at.y);
      expect(await lastEdit(page)).toEqual({
        kind: "position",
        line: ref.model,
        index: 0,
      });
    }
  });

  test("a click on the leftmost grapheme of a Hebrew line reports the last index", async ({
    page,
  }) => {
    await openEditing(page, "he_plain");
    const ref = lyricRefs(golden("he_plain"))[1];
    if (!ref) throw new Error("no second lyric line");
    const row = singleRow(await positions(page, ref.dom), "he_plain line 2");
    const leftmost = [...row].sort((a, b) => a.rect.xMin - b.rect.xMin)[0]!;
    const at = centre(leftmost.rect);
    await page.mouse.click(at.x, at.y);
    expect(await lastEdit(page)).toEqual({
      kind: "position",
      line: ref.model,
      index: ref.graphemes.length - 1,
    });
  });

  test("a click on a chord button reports that chord's anchor index", async ({
    page,
  }) => {
    await openEditing(page, "he_plain");
    const refs = lyricRefs(golden("he_plain"));
    for (const ref of refs) {
      expect(ref.line.chords.length).toBeGreaterThanOrEqual(2);
      for (let anchor = 0; anchor < ref.line.chords.length; anchor++) {
        await clearLastEdit(page);
        const button = page
          .locator("[data-line]")
          .nth(ref.dom)
          .locator(`[data-chord-button][data-anchor-index="${anchor}"]`);
        await expect(button).toHaveText(ref.line.chords[anchor]!.chord);
        const box = await button.boundingBox();
        if (!box) throw new Error("chord button has no box");
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        expect(await lastEdit(page)).toEqual({
          kind: "chord",
          line: ref.model,
          anchor,
        });
      }
    }
  });

  test("the end slot of a Hebrew line is at the visual left end and clickable", async ({
    page,
  }) => {
    await openEditing(page, "he_plain");
    const refs = lyricRefs(golden("he_plain"));
    // One line without and one with a chord on its end position.
    const count = (r: LyricRef) => r.graphemes.length;
    const plain = refs.find((r) =>
      r.line.chords.every((c) => c.index < count(r)),
    );
    const chorded = refs.find((r) =>
      r.line.chords.some((c) => c.index === count(r)),
    );
    if (!plain || !chorded) throw new Error("he_plain lacks an end-slot case");
    for (const ref of [plain, chorded]) {
      await clearLastEdit(page);
      const all = await positions(page, ref.dom);
      const row = singleRow(all, `he_plain line ${ref.model}`);
      const end = all.find((p) => p.end);
      if (!end) throw new Error("no end slot");
      expect(all.filter((p) => p.end)).toHaveLength(1);
      expect(end.pos).toBe(count(ref));
      const leftEdge = Math.min(...row.map((p) => p.rect.xMin));
      expect(
        end.rect.xMax,
        "end slot is left of every grapheme",
      ).toBeLessThanOrEqual(leftEdge + 0.5);
      expect(end.rect.xMax - end.rect.xMin).toBeGreaterThan(4);
      const at = centre(end.rect);
      const lyricY = centre(row[0]!.rect).y;
      await page.mouse.click(at.x, lyricY);
      expect(await lastEdit(page)).toEqual({
        kind: "position",
        line: ref.model,
        index: count(ref),
      });
    }
  });
});

test("editing niqqud integrity: every position holds one whole grapheme", async ({
  page,
}) => {
  await openEditing(page, "he_niqqud");
  const refs = lyricRefs(golden("he_niqqud"));
  let marked = 0;
  for (const ref of refs) {
    const all = await positions(page, ref.dom);
    expect(all.map((p) => p.pos)).toEqual(
      Array.from({ length: ref.graphemes.length + 1 }, (_, i) => i),
    );
    expect(all.filter((p) => !p.end).map((p) => p.text)).toEqual(ref.graphemes);
    expect(all[all.length - 1]).toMatchObject({ end: true, text: "" });
    for (const p of all) {
      if (p.end) continue;
      expect(splitGraphemes(p.text), `pos ${p.pos}`).toHaveLength(1);
      // No position starts with a mark split from its base letter.
      expect(/^[֑-ׇ]/u.test(p.text), `pos ${p.pos}`).toBe(false);
      if (/[֑-ׇ]/u.test(p.text)) {
        marked++;
        expect(p.text.length, `pos ${p.pos}`).toBeGreaterThan(1);
        expect(/^[א-ת]/u.test(p.text), `pos ${p.pos}`).toBe(true);
      }
    }
  }
  expect(marked).toBeGreaterThan(5);
});

test("editing print: UI chrome is not displayed, lines and chords still are", async ({
  page,
}) => {
  await openEditing(page, "he_plain");
  await page.emulateMedia({ media: "print" });
  const chrome = await page.evaluate(() =>
    [...document.querySelectorAll("[data-ui-chrome]")].map(
      (el) => getComputedStyle(el).display,
    ),
  );
  expect(chrome.length).toBeGreaterThan(0);
  for (const display of chrome) expect(display).toBe("none");
  const song = golden("he_plain");
  expect(await chordTexts(page)).toEqual(goldenChords(song));
  const shown = await page.evaluate(() => ({
    lines: [...document.querySelectorAll<HTMLElement>('[data-line="lyric"]')]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0).length,
    chords: [...document.querySelectorAll<HTMLElement>("[data-chord-button]")]
      .filter((el) => getComputedStyle(el).display !== "none")
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0).length,
  }));
  expect(shown.lines).toBe(lyricRefs(song).length);
  expect(shown.chords).toBe(goldenChords(song).length);
  const lines = await measure(page, song);
  for (const lm of lines) {
    for (const box of lm.boxes) {
      const g = lm.graphemes[Math.min(box.index, lm.graphemes.length - 1)];
      if (g) expect(box.rect.yMax).toBeLessThanOrEqual(g.rect.yMin + 2);
    }
  }
});
