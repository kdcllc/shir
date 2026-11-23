import { expect, test } from "@playwright/test";
import { STRINGS } from "../src/strings";
import { KEYED, KEYLESS, openApp, openSong } from "./stub";

/** Every `[data-ui-chrome]` element's computed display (must all be none in print). */
const chromeDisplays = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-ui-chrome]")].map((el) => ({
      id:
        el.getAttribute("data-testid") ??
        el.getAttribute("aria-label") ??
        el.tagName,
      display: getComputedStyle(el).display,
    })),
  );

interface AxNode {
  nodeId: string;
  backendDOMNodeId?: number;
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  childIds?: string[];
}

/** The full AX tree plus the backend node id of the first match for `selector`. */
async function axTreeAndBackendId(
  cdp: import("@playwright/test").CDPSession,
  selector: string,
): Promise<{ nodes: AxNode[]; backendNodeId: number }> {
  const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector,
  });
  expect(nodeId, `no DOM node for ${selector}`).toBeGreaterThan(0);
  const { node } = await cdp.send("DOM.describeNode", { nodeId });
  const tree = await cdp.send("Accessibility.getFullAXTree");
  return { nodes: tree.nodes as AxNode[], backendNodeId: node.backendNodeId };
}

/** The AX node whose backendDOMNodeId is the element matching `selector`. */
async function axNodeFor(
  cdp: import("@playwright/test").CDPSession,
  selector: string,
): Promise<AxNode | undefined> {
  const { nodes, backendNodeId } = await axTreeAndBackendId(cdp, selector);
  return nodes.find((n) => n.backendDOMNodeId === backendNodeId);
}

/** Names of the AX descendants of the element matching `selector`, joined. */
async function axSubtreeText(
  cdp: import("@playwright/test").CDPSession,
  selector: string,
): Promise<string | undefined> {
  const { nodes, backendNodeId } = await axTreeAndBackendId(cdp, selector);
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const start = nodes.find((n) => n.backendDOMNodeId === backendNodeId);
  if (start === undefined) return undefined;
  const parts: string[] = [];
  const visit = (n: AxNode): void => {
    for (const id of n.childIds ?? []) {
      const child = byId.get(id);
      if (child === undefined) continue;
      if (child.name?.value) parts.push(String(child.name.value));
      visit(child);
    }
  };
  visit(start);
  return parts.join(" ");
}

test.describe("print media (built frontend)", () => {
  test("F28: viewer chrome is hidden, song content stays", async ({ page }) => {
    await openApp(page);
    await openSong(page, KEYED.title);
    // Each region's named control is on screen first, so "hidden in print" cannot
    // pass on a control that was never rendered.
    const controls = [
      "transpose-up",
      "reset-view",
      "library-sort",
      "library-filter-all",
      "search-input",
      "new-song",
    ];
    for (const id of controls) {
      await expect(page.getByTestId(id), id).toBeVisible();
    }
    await page.emulateMedia({ media: "print" });
    for (const id of controls) {
      await expect(page.getByTestId(id), id).toBeHidden();
    }

    const chrome = await chromeDisplays(page);
    // Sidebar, toolbars, header actions and the locale toggle are all marked.
    expect(chrome.length).toBeGreaterThan(5);
    expect(chrome.filter((c) => c.display !== "none")).toEqual([]);
    for (const id of [
      "locale-toggle",
      "song-list",
      "edit-song",
      "delete-song",
    ]) {
      expect(chrome.map((c) => c.id)).toContain(id);
    }

    await expect(page.getByTestId("song-title")).toBeVisible();
    // The first letter of a lyric is its own anchor span (chord box), so match the tail.
    const lyrics = page.locator('[data-song] [data-line="lyric"]');
    await expect(lyrics).toHaveCount(2);
    await expect(lyrics.nth(0)).toBeVisible();
    await expect(lyrics.nth(0)).toContainText("irst lyric line");
    await expect(lyrics.nth(1)).toBeVisible();
    await expect(lyrics.nth(1)).toContainText("econd lyric line");
  });

  test("F30: No key is hidden, a real key prints", async ({ page }) => {
    await openApp(page);
    await openSong(page, KEYLESS.title);
    await expect(page.getByTestId("sounding-key")).toBeVisible();
    await expect(page.getByText(STRINGS.noKey)).toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("sounding-key")).toBeHidden();
    await expect(page.getByText(STRINGS.noKey)).toBeHidden();

    await page.emulateMedia({ media: "screen" });
    await openSong(page, KEYED.title);
    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("sounding-key")).toBeVisible();
    await expect(page.getByTestId("sounding-key")).toHaveText(KEYED.key);
  });

  test("F36: the open editor prints no controls", async ({ page }) => {
    await openApp(page);
    await openSong(page, KEYED.title);
    await page.getByTestId("edit-song").click();
    await page.waitForSelector('[data-testid="editor-visual"]');

    // Open the chord picker too, so it is part of what must not print.
    await page
      .locator('[data-testid="visual-line"][data-kind="lyric"]')
      .first()
      .locator('[data-pos="1"]')
      .click();
    await expect(page.getByTestId("chord-picker")).toBeVisible();
    await page.emulateMedia({ media: "print" });

    const chrome = await chromeDisplays(page);
    expect(chrome.length).toBeGreaterThan(5);
    expect(chrome.filter((c) => c.display !== "none")).toEqual([]);
    // Meta form, section controls and the picker each sit inside marked chrome.
    for (const id of [
      "meta-form",
      "add-section",
      "chord-picker",
      "chord-input",
    ]) {
      const marked = await page
        .getByTestId(id)
        .first()
        .evaluate((el) => el.closest("[data-ui-chrome]") !== null);
      expect(marked, id).toBe(true);
      await expect(page.getByTestId(id).first(), id).toBeHidden();
    }
  });
});

test.describe("accessibility (built frontend)", () => {
  test("F51: the empty chord warning stays in the rendering tree", async ({
    page,
  }) => {
    await openApp(page);
    await openSong(page, KEYED.title);
    await page.getByTestId("edit-song").click();
    await page.waitForSelector('[data-testid="editor-visual"]');
    await page
      .locator('[data-testid="visual-line"][data-kind="lyric"]')
      .first()
      .locator('[data-pos="1"]')
      .click();
    const status = page.getByTestId("chord-picker").getByRole("status");
    await expect(status).toHaveCount(1);
    await expect(status).toHaveText("");

    const style = await status.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { display: cs.display, visibility: cs.visibility };
    });
    expect(style.display).not.toBe("none");
    expect(style.visibility).not.toBe("hidden");

    await page.getByTestId("chord-input").fill("xyz");
    await expect(status).toHaveText(STRINGS.chordUnknown);
  });
  test("F51: the empty chord warning is a status node in Chromium's accessibility tree", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "CDP is Chromium-only");
    await openApp(page);
    await openSong(page, KEYED.title);
    await page.getByTestId("edit-song").click();
    await page.waitForSelector('[data-testid="editor-visual"]');
    await page
      .locator('[data-testid="visual-line"][data-kind="lyric"]')
      .first()
      .locator('[data-pos="1"]')
      .click();
    const status = page.getByTestId("chord-picker").getByRole("status");
    await expect(status).toHaveCount(1);
    await expect(status).toHaveText("");

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Accessibility.enable");
    const selector = '[data-testid="chord-warning"]';
    const before = await axNodeFor(cdp, selector);
    expect(before, "no AX node for the empty chord warning").toBeDefined();
    expect(before?.role?.value).toBe("status");
    expect(before?.ignored).not.toBe(true);

    await page.getByTestId("chord-input").fill("xyz");
    await expect(status).toHaveText(STRINGS.chordUnknown);
    const after = await axNodeFor(cdp, selector);
    expect(after?.role?.value).toBe("status");
    const name = String(after?.name?.value ?? "");
    const descendants = (await axSubtreeText(cdp, selector)) ?? "";
    expect(name + descendants).toContain(STRINGS.chordUnknown);
  });

  test("sidebar panels are tabpanels in Chromium's accessibility tree", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "CDP is Chromium-only");
    await openApp(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Accessibility.enable");

    const songs = await axNodeFor(cdp, '[data-testid="sidebar-panel-songs"]');
    expect(songs, "no AX node for sidebar-panel-songs").toBeDefined();
    expect(songs?.role?.value).toBe("tabpanel");
    expect(songs?.ignored).not.toBe(true);

    await page.getByTestId("tab-setlists").click();
    const setlists = await axNodeFor(
      cdp,
      '[data-testid="sidebar-panel-setlists"]',
    );
    expect(setlists, "no AX node for sidebar-panel-setlists").toBeDefined();
    expect(setlists?.role?.value).toBe("tabpanel");
    expect(setlists?.ignored).not.toBe(true);
  });
});
