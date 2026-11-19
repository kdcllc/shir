import { $, $$, browser, expect } from "@wdio/globals";
import { EN } from "../../apps/desktop/src/i18n/en";
import { relaunch, tid, waitForShell } from "../src/harness";
import { LANGS } from "../src/launch";
import { createSong, textsOf } from "../src/ui";

const HEBREW_SONG =
  "{title: שיר עברי}\n{artist: זמר}\n\n[Am]ערב רגוע על [F]הגגות";
const ENGLISH_SONG =
  "{title: Plain English}\n{artist: Anne Singer}\n\n[C]Morning [G]light on an open road";
const MIXED_SONG =
  "{title: Mixed Probe}\n{artist: Mixed Artist}\n\n[C]Hello [G]world\n[Am]ערב רגוע על [F]הגגות";

const collator = new Intl.Collator(["he", "en"], {
  sensitivity: "base",
  numeric: true,
});

const BADGE = {
  he: EN.badgeHebrew,
  en: EN.badgeEnglish,
  mixed: EN.badgeMixed,
} as const;

const ROWS = '[data-testid="song-index"] [data-testid="song-item"]';

/** Artist of every listed row (`null` when the row has none), in list order. */
async function listedArtists(): Promise<(string | null)[]> {
  return browser.execute((rows: string) => {
    return Array.from(document.querySelectorAll(rows)).map((item) => {
      // The first dir="auto" span is the title, the second the artist.
      const spans = Array.from(item.children).filter(
        (c) =>
          c.getAttribute("dir") === "auto" && !c.hasAttribute("data-testid"),
      );
      return spans[1] === undefined
        ? null
        : (spans[1].textContent ?? "").trim();
    });
  }, ROWS);
}

async function listedTitles(): Promise<string[]> {
  return browser.execute((rows: string) => {
    return Array.from(document.querySelectorAll(rows)).map((item) =>
      (item.querySelector("span")?.textContent ?? "").trim(),
    );
  }, ROWS);
}

describe("library filter and sort", () => {
  before(async () => {
    await waitForShell();
    await createSong(HEBREW_SONG);
    await createSong(ENGLISH_SONG);
    await createSong(MIXED_SONG);
  });

  for (const language of ["he", "en", "mixed"] as const) {
    it(`filter ${language} lists only rows with the ${BADGE[language]} badge`, async () => {
      await tid(`library-filter-${language}`).click();
      await tid("song-index").waitForExist();
      const badges = await textsOf("song-language");
      expect(badges.length).toBeGreaterThan(0);
      expect(badges.every((b) => b === BADGE[language])).toBe(true);
    });
  }

  it("shows rows of all three languages under the All filter", async () => {
    await tid("library-filter-all").click();
    const badges = new Set(await textsOf("song-language"));
    expect(badges).toEqual(
      new Set([EN.badgeHebrew, EN.badgeEnglish, EN.badgeMixed]),
    );
  });

  it("sorts by artist, rows without an artist last", async () => {
    const sort = $('[data-testid="library-sort"]');
    await sort.selectByAttribute("value", "title");
    const byTitle = await listedTitles();
    await sort.selectByAttribute("value", "artist");
    const artists = await listedArtists();
    const named = artists.filter((a): a is string => a !== null);
    expect(named.length).toBeGreaterThan(2);
    expect(artists.slice(0, named.length)).toEqual(named);
    for (let i = 1; i < named.length; i++) {
      expect(collator.compare(named[i - 1]!, named[i]!)).toBeLessThanOrEqual(0);
    }
    // The artist order is not just the title order.
    expect(await listedTitles()).not.toEqual(byTitle);
  });

  it("restores the filter and the sort after a restart", async () => {
    await tid("library-filter-he").click();
    await $('[data-testid="library-sort"]').selectByAttribute(
      "value",
      "artist",
    );
    const titles = await listedTitles();
    await relaunch({ lang: LANGS.en });
    await expect(tid("library-filter-he")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect($('[data-testid="library-sort"]')).toHaveValue("artist");
    expect(await listedTitles()).toEqual(titles);
    expect((await $$('[role="radio"][aria-checked="true"]')).length).toBe(1);
  });
});
