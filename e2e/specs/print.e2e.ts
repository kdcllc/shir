import { $$, browser, expect } from "@wdio/globals";
import { relaunch, tid, waitForShell } from "../src/harness";
import { LANGS } from "../src/launch";
import { createSong, textsOf } from "../src/ui";

const TITLE = "Print Probe";
const SONG = `{title: ${TITLE}}\n{key: C}\n\n[C]Evening [G]lamps along the quay\n[Am]Quiet [F]boats come home`;

const CONTROLS = [
  "new-song",
  "search-input",
  "song-list",
  "edit-song",
  "locale-toggle",
];

/** Opens the probe song from the song list. */
async function openProbe(): Promise<void> {
  const index = (await textsOf("song-item")).findIndex((t) =>
    t.includes(TITLE),
  );
  if (index < 0) throw new Error(`song ${TITLE} is not listed`);
  await (await $$('[data-testid="song-item"]'))[index]!.click();
  await expect(tid("song-title")).toHaveText(TITLE);
}

/**
 * WebKitGTK cannot emulate print media, so this copies the app's own `@media print`
 * rule texts into a trailing stylesheet (a constructed sheet, because the app's CSP blocks
 * inline style text). Returns the number of rules collected and the
 * collected text.
 */
async function unwrapPrintRules(): Promise<{ count: number; text: string }> {
  return browser.execute(() => {
    const collected: string[] = [];
    const isPrint = (medium: string): boolean => {
      const m = medium.trim().toLowerCase();
      return m === "print" || m.startsWith("print ");
    };
    const walk = (rules: CSSRuleList): void => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSMediaRule) {
          const media = Array.from(rule.media);
          if (media.some(isPrint)) {
            for (const inner of Array.from(rule.cssRules)) {
              collected.push(inner.cssText);
            }
          }
        }
        const nested = (rule as { cssRules?: CSSRuleList }).cssRules;
        if (nested !== undefined) walk(nested);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      walk(rules);
    }
    const style = document.createElement("style");
    style.setAttribute("data-e2e-print-unwrap", "");
    document.head.appendChild(style);
    // The app's CSP (style-src 'self') blocks inline style text, even an empty
    // <style> sheet, so the copied rules go in as a constructed sheet adopted last.
    const sheet = new CSSStyleSheet();
    for (const rule of collected) sheet.insertRule(rule, sheet.cssRules.length);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return { count: collected.length, text: collected.join("\n") };
  });
}

/** The printed-chrome checks shared by the English and Hebrew runs. */
async function checkPrintChrome(): Promise<void> {
  for (const id of CONTROLS) {
    await expect(tid(id)).toBeDisplayed();
  }

  const { count, text } = await unwrapPrintRules();
  expect(text).toContain("[data-ui-chrome]");
  expect(count).toBeGreaterThanOrEqual(3);

  const chrome = await browser.execute(() =>
    Array.from(document.querySelectorAll("[data-ui-chrome]")).map((el) => ({
      id:
        el.getAttribute("data-testid") ??
        el.getAttribute("aria-label") ??
        el.tagName,
      display: getComputedStyle(el).display,
    })),
  );
  expect(chrome.length).toBeGreaterThan(5);
  expect(chrome.filter((c) => c.display !== "none")).toEqual([]);

  await expect(tid("song-title")).toBeDisplayed();
  await expect(tid("song-title")).toHaveText(TITLE);
  const lyrics = await browser.execute(() =>
    Array.from(
      document.querySelectorAll('[data-song] [data-line="lyric"]'),
    ).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        display: getComputedStyle(el).display,
        width: r.width,
        height: r.height,
      };
    }),
  );
  expect(lyrics).toHaveLength(2);
  for (const lyric of lyrics) {
    expect(lyric.display).not.toBe("none");
    expect(lyric.width).toBeGreaterThan(0);
    expect(lyric.height).toBeGreaterThan(0);
  }

  // Dropping the injected sheet brings the chrome back: it alone caused the hiding.
  await browser.execute(() => {
    document.querySelector("style[data-e2e-print-unwrap]")?.remove();
    document.adoptedStyleSheets = [];
  });
  await expect(tid("new-song")).toBeDisplayed();
}

describe("print chrome in the real engine", () => {
  before(async () => {
    await waitForShell();
    await createSong(SONG);
  });

  it("hides the chrome and keeps the lyrics in the English UI", async () => {
    await openProbe();
    await checkPrintChrome();
  });

  it("does the same in the Hebrew (right-to-left) UI", async () => {
    await relaunch({ lang: LANGS.he });
    expect(await browser.execute(() => document.documentElement.dir)).toBe(
      "rtl",
    );
    await openProbe();
    await checkPrintChrome();
  });
});
