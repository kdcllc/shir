import { expect, test } from "@playwright/test";
import {
  anchorEdgeErrors,
  fontsInUse,
  golden,
  measure,
  open,
  overlapCount,
  wrapReport,
} from "./helpers";

test("selftest (a) checklist 2 detects a shifted chord box", async ({
  page,
}) => {
  await open(page, "he_plain", { width: 720 });
  await page.addStyleTag({
    content: "[data-chord-box]{inset-inline-start:8px !important}",
  });
  const song = golden("he_plain");
  const errors = anchorEdgeErrors(song, await measure(page, song));
  expect(errors.filter((e) => e.error > 2).length).toBeGreaterThanOrEqual(1);
});

test("selftest (b) checklist 3 detects removed overlap padding", async ({
  page,
}) => {
  await open(page, "dense_chords", { width: 360 });
  await page.addStyleTag({
    content:
      "[data-song] [data-seg],[data-song] [data-anchor]{padding-inline-end:0 !important}",
  });
  expect(
    overlapCount(await measure(page, golden("dense_chords"))),
  ).toBeGreaterThanOrEqual(1);
});

test("selftest (c) font assertion detects missing fonts", async ({ page }) => {
  await open(page, "he_plain", { nofonts: true });
  expect(await fontsInUse(page)).toBe(false);
});

test("selftest (d) checklist 5 detects chords crossing rows", async ({
  page,
}) => {
  await open(page, "long_wrap_line", { width: 360 });
  await page.addStyleTag({ content: "[data-line]{line-height:1 !important}" });
  const song = golden("long_wrap_line");
  const report = wrapReport(song, await measure(page, song));
  expect(report.crossRow).toBeGreaterThanOrEqual(1);
});
