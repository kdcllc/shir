import { expect, test } from "@playwright/test";
import { FIXTURE_NAMES } from "test-fixtures";
import type { FixtureName } from "test-fixtures";
import {
  CHORDED_FIXTURES,
  anchorEdgeErrors,
  boxesBelowAnchor,
  chordTexts,
  fontsInUse,
  golden,
  renderedLines,
  goldenChords,
  measure,
  open,
  overlapCount,
  overlapPass,
  wordRects,
  wrapReport,
  charXs,
} from "./helpers";

const EDGE_FIXTURES: FixtureName[] = [
  "he_plain",
  "he_niqqud",
  "en_plain",
  "mixed_he_en",
  "sharp_flat_extensions",
  "long_wrap_line",
];

test.describe("checklist 1", () => {
  for (const name of FIXTURE_NAMES) {
    test(`checklist 1 textContent equality ${name}`, async ({ page }) => {
      await open(page, name);
      expect(await fontsInUse(page)).toBe(true);
      expect(await chordTexts(page)).toEqual(goldenChords(golden(name)));
    });
  }
});

test.describe("checklist 2", () => {
  for (const name of EDGE_FIXTURES) {
    test(`checklist 2 anchor edge <= 2px ${name}`, async ({ page }) => {
      await open(page, name, { width: 720 });
      expect(await fontsInUse(page)).toBe(true);
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
  }

  test("checklist 2 mixed_he_en rock/roll run starts", async ({ page }) => {
    await open(page, "mixed_he_en", { width: 720 });
    const song = golden("mixed_he_en");
    const line = song.lines.find(
      (l) => l.kind === "lyric" && l.lyric.includes("rock"),
    );
    if (!line || line.kind !== "lyric") throw new Error("no rock line");
    const iR = line.lyric.indexOf("rock");
    const iO = line.lyric.indexOf("roll") + 1;
    const indices = line.chords.map((c) => c.index);
    expect(indices).toContain(iR);
    expect(indices).toContain(iO);
    const errors = anchorEdgeErrors(song, await measure(page, song));
    for (const idx of [iR, iO]) {
      const e = errors.find((x) => x.index === idx);
      expect(e, `chord at ${idx}`).toBeDefined();
      expect(e?.error ?? 99).toBeLessThanOrEqual(2);
    }
  });
});

test.describe("checklist 3", () => {
  for (const name of CHORDED_FIXTURES) {
    for (const width of [360, 720]) {
      test(`checklist 3 no overlap ${name} @${width}`, async ({ page }) => {
        await open(page, name, { width });
        expect(await fontsInUse(page)).toBe(true);
        expect(overlapCount(await measure(page, golden(name)))).toBe(0);
      });
    }
  }

  for (const name of ["dense_chords", "mixed_he_en"] as const) {
    test(`checklist 3 resize re-run ${name}`, async ({ page }) => {
      await open(page, name, { width: 720 });
      const before = await overlapPass(page);
      await page.evaluate(() => window.__setWidth?.(360));
      await expect.poll(() => overlapPass(page)).toBeGreaterThan(before);
      expect(overlapCount(await measure(page, golden(name)))).toBe(0);
    });
  }
});

test("checklist 4 mixed word order", async ({ page }) => {
  await open(page, "mixed_he_en", { width: 720 });
  const song = golden("mixed_he_en");
  const idx = renderedLines(song).findIndex(
    (l) => l.kind === "lyric" && l.lyric.includes("rock"),
  );
  const words = await wordRects(page, idx);
  const x = (w: string) => {
    const hit = words.find((r) => r.word === w);
    if (!hit) throw new Error(`no word ${w}`);
    return hit.rect.xMin;
  };
  expect(x("rock")).toBeLessThan(x("and"));
  expect(x("and")).toBeLessThan(x("roll"));
  const he = words.filter((w) => /^[֐-׿]+$/.test(w.word));
  expect(he.length).toBeGreaterThanOrEqual(4);
  for (let i = 1; i < he.length; i++) {
    expect((he[i] as { rect: { xMin: number } }).rect.xMin).toBeLessThan(
      (he[i - 1] as { rect: { xMin: number } }).rect.xMin,
    );
  }
});

test("checklist 5 wrap", async ({ page }) => {
  await open(page, "long_wrap_line", { width: 360 });
  expect(await fontsInUse(page)).toBe(true);
  const song = golden("long_wrap_line");
  const report = wrapReport(song, await measure(page, song));
  expect(report.rows).toBeGreaterThanOrEqual(2);
  expect(report.misplaced).toBe(0);
  expect(report.crossRow).toBe(0);
});

test("checklist 6 print CSS", async ({ page }) => {
  await open(page, "he_plain", { width: 720 });
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("[data-ui-chrome]")).toBeHidden();
  const song = golden("he_plain");
  expect(boxesBelowAnchor(song, await measure(page, song))).toBe(0);
  await expect(page.locator("[data-harness]")).toHaveScreenshot(
    "print-he_plain.png",
  );
});

test("B6 chord-only line order", async ({ page }) => {
  await open(page, "chord_only_line", { width: 720 });
  const song = golden("chord_only_line");
  const idx = renderedLines(song).findIndex((l) => l.kind === "chords");
  const chords = await page.evaluate((i) => {
    const line = document.querySelectorAll("[data-line]")[i];
    return [...(line?.querySelectorAll(".chord") ?? [])].map((e) => ({
      text: e.textContent ?? "",
      x: e.getBoundingClientRect().x,
    }));
  }, idx);
  const line = renderedLines(song)[idx];
  if (!line || line.kind !== "chords") throw new Error("no chord line");
  expect(chords.map((c) => c.text)).toEqual(line.chords);
  for (let i = 1; i < chords.length; i++) {
    expect((chords[i] as { x: number }).x).toBeLessThan(
      (chords[i - 1] as { x: number }).x,
    );
  }
});

test("B1 chord glyph order is LTR", async ({ page }) => {
  await open(page, "sharp_flat_extensions", { width: 720 });
  const xs = await charXs(page, "F#m7(b5)");
  expect(xs[0]).toBeLessThan(xs[1] as number);
  const text = "F#m7(b5)";
  const at = (c: string) => xs[text.indexOf(c)] as number;
  expect(at("(")).toBeLessThan(at("b"));
  expect(at("b")).toBeLessThan(at("5"));
  expect(at("5")).toBeLessThan(at(")"));
  for (let i = 1; i < xs.length; i++) {
    expect(xs[i] as number).toBeGreaterThan(xs[i - 1] as number);
  }
});

test("B10 niqqud rendering", async ({ page }) => {
  await open(page, "he_niqqud", { width: 720 });
  expect(await fontsInUse(page)).toBe(true);
  const song = golden("he_niqqud");
  const lines = await measure(page, song);
  const marked = lines
    .flatMap((l) => l.graphemes)
    .filter((g) => /[֑-ׇ]/.test(g.text));
  expect(marked.length).toBeGreaterThan(5);
  for (const g of marked) {
    expect(g.rectCount, g.text).toBe(1);
  }
  await expect(page.locator("[data-song]")).toHaveScreenshot(
    "niqqud-he_niqqud.png",
  );
});
