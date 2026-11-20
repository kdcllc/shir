import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { DENSE, HEBREW, KEYED, openApp } from "./stub";

/** Opens the app, builds a setlist of three stub songs and opens it in the Setlists tab. */
async function openSetlist(page: Page, opts: { rtl?: boolean } = {}) {
  await openApp(page);
  // Record every IPC command (the app resolves `invoke` at call time).
  await page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (c: string, a?: unknown) => Promise<unknown>;
      };
      __calls: string[];
    };
    w.__calls = [];
    const orig = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (c, a) => {
      w.__calls.push(c);
      return orig(c, a);
    };
  });
  if (opts.rtl) {
    await page.getByTestId("locale-he").click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  }
  await page.getByTestId("select-songs").click();
  for (const title of [KEYED.title, HEBREW.title, DENSE.title]) {
    await page
      .getByTestId("song-item")
      .filter({ hasText: title })
      .first()
      .click();
  }
  await page.getByTestId("add-selected-to-setlist").click();
  await page.getByTestId("add-to-setlist-name").fill("Evening set");
  await page.getByTestId("add-to-setlist-confirm").click();
  await page.getByTestId("select-done").click();
  await page.getByTestId("tab-setlists").click();
  await page.getByTestId("setlist-select").first().click();
  await expect(page.getByTestId("setlist-entry")).toHaveCount(3);
}

const entryTitles = (page: Page) =>
  page.getByTestId("setlist-entry-title").allInnerTexts();

const callCount = (page: Page, cmd: string) =>
  page.evaluate(
    (c) =>
      (window as unknown as { __calls: string[] }).__calls.filter(
        (x) => x === c,
      ).length,
    cmd,
  );

for (const rtl of [false, true]) {
  test(`pointer drag of an entry handle reorders once (${rtl ? "rtl" : "ltr"})`, async ({
    page,
  }) => {
    await openSetlist(page, { rtl });
    const before = await entryTitles(page);
    expect(before).toHaveLength(3);
    expect(await callCount(page, "reorder_setlist_items")).toBe(0);

    const handle = page.getByTestId("setlist-entry-handle").first();
    const second = page.getByTestId("setlist-entry").nth(1);
    const hb = (await handle.boundingBox())!;
    const sb = (await second.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2 + 6, {
      steps: 8,
    });
    await page.mouse.up();

    await expect
      .poll(() => entryTitles(page))
      .toEqual([before[1], before[0], before[2]]);
    expect(await callCount(page, "reorder_setlist_items")).toBe(1);
  });
}

/** Layout facts captured synchronously when `window.print()` is called. */
interface Probe {
  display: string;
  inlineSize: number;
  passes: number[];
  denseBoxes: { top: number; bottom: number; left: number; right: number }[][];
}

async function installProbe(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __printProbe?: unknown;
      print: () => void;
    };
    w.print = () => {
      const root = document.querySelector("[data-print-root]") as HTMLElement;
      const songs = [
        ...document.querySelectorAll("[data-print-song] [data-song]"),
      ];
      const dense = [...document.querySelectorAll("[data-print-song]")].find(
        (s) => s.querySelector("h2")?.textContent === "Dense Chords",
      );
      const denseBoxes = [
        ...(dense?.querySelectorAll('[data-line="lyric"]') ?? []),
      ].map((line) =>
        [...line.querySelectorAll("[data-chord-box]")].map((b) => {
          const r = b.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
        }),
      );
      w.__printProbe = {
        display: getComputedStyle(root).display,
        inlineSize: root.getBoundingClientRect().width,
        passes: songs.map((s) => Number(s.getAttribute("data-overlap-pass"))),
        denseBoxes,
      };
    };
  });
}

test.describe("setlist print layout", () => {
  test("screen phase probe, print-media layout, and cleanup", async ({
    page,
  }) => {
    await openSetlist(page);
    const titles = await entryTitles(page);
    await installProbe(page);
    await page.getByTestId("setlist-print").click();
    await page.waitForSelector("[data-print-root]", { state: "attached" });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __printProbe?: unknown }).__printProbe !==
            undefined,
        ),
      )
      .toBe(true);

    // ---- screen phase (before any print media emulation) ----
    const probe = (await page.evaluate(
      () => (window as unknown as { __printProbe: Probe }).__printProbe,
    )) as Probe;
    expect(probe.display).not.toBe("none");
    // 180 mm at 96 dpi = 680.3 px.
    const mm180 = (180 / 25.4) * 96;
    expect(Math.abs(probe.inlineSize - mm180)).toBeLessThanOrEqual(2);
    expect(probe.passes).toHaveLength(3);
    for (const p of probe.passes) expect(p).toBeGreaterThanOrEqual(1);
    // Precondition: the dense song really has several chord boxes per line.
    expect(probe.denseBoxes.some((boxes) => boxes.length >= 6)).toBe(true);
    for (const boxes of probe.denseBoxes) {
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          const sameRow =
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
          if (!sameRow) continue;
          const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          expect(
            overlap,
            `chord boxes ${i} and ${j} overlap`,
          ).toBeLessThanOrEqual(0.5);
        }
      }
    }

    // ---- print phase (the root is still mounted: cleanup waits for afterprint / input) ----
    await expect(page.locator("[data-print-root]")).toHaveCount(1);
    await page.emulateMedia({ media: "print" });

    expect(
      await page.evaluate(
        () => getComputedStyle(document.getElementById("root")!).display,
      ),
    ).toBe("none");
    await expect(page.locator("[data-print-root]")).toBeVisible();
    const cover = page.locator("[data-print-cover-item]");
    await expect(cover).toHaveCount(titles.length);
    for (const t of titles) {
      await expect(page.locator("[data-print-cover]")).toContainText(t);
    }
    const breaks = await page.evaluate(() =>
      [...document.querySelectorAll("[data-print-song]")].map((s) => {
        const cs = getComputedStyle(s) as CSSStyleDeclaration & {
          breakBefore?: string;
        };
        return cs.breakBefore ?? cs.getPropertyValue("break-before");
      }),
    );
    expect(breaks).toEqual(["page", "page", "page"]);
    const visibleChrome = await page.evaluate(() =>
      [...document.querySelectorAll("[data-ui-chrome]")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return (
            getComputedStyle(el).display !== "none" || r.width * r.height > 0
          );
        })
        .map((el) => el.getAttribute("data-testid") ?? el.tagName),
    );
    expect(visibleChrome).toEqual([]);

    // Hebrew song: every chord box sits above its lyric text and inside its inline extent.
    const hebrew = await page.evaluate(() => {
      const sec = [...document.querySelectorAll("[data-print-song]")].find(
        (s) => s.querySelector("h2")?.textContent === "שיר הבוקר",
      )!;
      return [...sec.querySelectorAll('[data-line="lyric"]')].map((line) => {
        const l = line.getBoundingClientRect();
        return {
          left: l.left,
          right: l.right,
          boxes: [...line.querySelectorAll("[data-chord-box]")].map((b) => {
            const r = b.getBoundingClientRect();
            // The lyric text's top edge is its anchor's inline box (the chord box sits above it).
            const text = b.parentElement!.getBoundingClientRect();
            return {
              bottom: r.bottom,
              textTop: text.top,
              left: r.left,
              right: r.right,
            };
          }),
        };
      });
    });
    expect(hebrew).toHaveLength(2);
    for (const line of hebrew) {
      expect(line.boxes.length).toBeGreaterThanOrEqual(3);
      for (const b of line.boxes) {
        expect(b.bottom).toBeLessThanOrEqual(b.textTop + 1);
        expect(b.left).toBeGreaterThanOrEqual(line.left - 1);
        expect(b.right).toBeLessThanOrEqual(line.right + 1);
      }
    }

    // ---- (c) cleanup on afterprint ----
    await page.emulateMedia({ media: "screen" });
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await expect(page.locator("[data-print-root]")).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.dataset.printing),
    ).toBeUndefined();
  });

  test("cleanup also follows the first pointerdown after print returned", async ({
    page,
  }) => {
    await openSetlist(page);
    await installProbe(page);
    await page.getByTestId("setlist-print").click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __printProbe?: unknown }).__printProbe !==
            undefined,
        ),
      )
      .toBe(true);
    await expect(page.locator("[data-print-root]")).toHaveCount(1);
    expect(
      await page.evaluate(() => document.documentElement.dataset.printing),
    ).toBe("export");
    await page.evaluate(() => document.dispatchEvent(new Event("pointerdown")));
    await expect(page.locator("[data-print-root]")).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.dataset.printing),
    ).toBeUndefined();
  });
});

test("setlist Word export produces a real zip with word/document.xml", async ({
  page,
}) => {
  await openSetlist(page);
  await page.getByTestId("setlist-export-word").click();
  await page.waitForFunction(
    () =>
      (window as unknown as { __savedExport?: unknown }).__savedExport !==
      undefined,
  );
  const saved = await page.evaluate(() => {
    const s = (
      window as unknown as {
        __savedExport: { defaultName: string; bytes: number[] };
      }
    ).__savedExport;
    const bytes = Array.from(s.bytes);
    return {
      defaultName: s.defaultName,
      head: bytes.slice(0, 4),
      hasDocumentXml: new TextDecoder("latin1")
        .decode(new Uint8Array(bytes))
        .includes("word/document.xml"),
      length: bytes.length,
    };
  });
  expect(saved.head).toEqual([0x50, 0x4b, 0x03, 0x04]);
  expect(saved.hasDocumentXml).toBe(true);
  expect(saved.length).toBeGreaterThan(1000);
  expect(saved.defaultName.endsWith(".docx")).toBe(true);
});
