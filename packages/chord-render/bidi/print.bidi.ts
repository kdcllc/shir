import { expect, test } from "@playwright/test";
import { chordTexts, golden, goldenChords, open } from "./helpers";

// F29: the print rule must win the cascade in a real engine. `[data-ui-chrome]` ties on
// specificity with a component class that sets `display: flex`, so the test adds such a class
// AFTER the bundled CSS: only `!important` keeps the chrome hidden.
for (const editing of [false, true]) {
  test(`F29 print media hides every [data-ui-chrome], song lines stay visible (${editing ? "editing" : "read-only"})`, async ({
    page,
  }) => {
    await open(page, "he_plain", { width: 720, editing });
    await page.addStyleTag({
      content: ".chrome-probe { display: flex; }",
    });
    await page.evaluate(() => {
      document.querySelector("[data-ui-chrome]")?.classList.add("chrome-probe");
      const extra = document.createElement("div");
      extra.setAttribute("data-ui-chrome", "");
      extra.className = "chrome-probe";
      document.body.append(extra);
    });
    // Screen media: the probe class wins, so the chrome is displayed.
    const screen = await page.evaluate(() =>
      [...document.querySelectorAll("[data-ui-chrome]")].map(
        (el) => getComputedStyle(el).display,
      ),
    );
    expect(screen).toEqual(["flex", "flex"]);

    await page.emulateMedia({ media: "print" });
    const chrome = await page.evaluate(() =>
      [...document.querySelectorAll("[data-ui-chrome]")].map(
        (el) => getComputedStyle(el).display,
      ),
    );
    expect(chrome).toEqual(["none", "none"]);

    const song = golden("he_plain");
    const shown = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-line="lyric"]')].map(
        (el) => {
          const r = el.getBoundingClientRect();
          return {
            display: getComputedStyle(el).display,
            visible: r.width > 0 && r.height > 0,
          };
        },
      ),
    );
    expect(shown.length).toBeGreaterThan(0);
    for (const line of shown) {
      expect(line.display).not.toBe("none");
      expect(line.visible).toBe(true);
    }
    expect(await chordTexts(page)).toEqual(goldenChords(song));
  });
}
