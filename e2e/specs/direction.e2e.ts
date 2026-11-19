import { $$, browser, expect } from "@wdio/globals";
import { HE } from "../../apps/desktop/src/i18n/he";
import { tid, waitForShell } from "../src/harness";
import { createSong } from "../src/ui";

const ENGLISH_SONG =
  "{title: English Direction Probe}\n{artist: Probe}\n\n[C]Hello [G]darkness my old friend";
const HEBREW_SONG =
  "{title: בדיקת כיוון}\n{artist: בודק}\n\n[Am]ערב רגוע על [F]הגגות";

/** Computed `direction` of the first lyric line in the song pane. */
async function lyricDirection(): Promise<string> {
  return browser.execute(() => {
    const line = document.querySelector(
      '[data-testid="song-pane"] [data-line="lyric"]',
    );
    if (line === null) throw new Error("no lyric line in the song pane");
    return getComputedStyle(line).direction;
  });
}

async function pickSong(title: string): Promise<void> {
  const items = await $$('[data-testid="song-item"]');
  for (const item of items) {
    if ((await item.getText()).includes(title)) {
      await item.click();
      await browser.waitUntil(
        async () => (await tid("song-title").getText()).includes(title),
        { timeoutMsg: `song ${title} never opened` },
      );
      return;
    }
  }
  throw new Error(`no song row containing ${title}`);
}

describe("song direction inside the Hebrew interface", () => {
  before(async () => {
    await waitForShell();
    await createSong(ENGLISH_SONG);
    await createSong(HEBREW_SONG);
    await tid("locale-he").click();
  });

  it("keeps an English song's lyric line left-to-right", async () => {
    await pickSong("English Direction Probe");
    expect(await lyricDirection()).toBe("ltr");
  });

  it("keeps a Hebrew song's lyric line right-to-left", async () => {
    await pickSong("בדיקת כיוון");
    expect(await lyricDirection()).toBe("rtl");
  });

  it("keeps the transpose up button text as a plus sign", async () => {
    await expect(tid("transpose-up")).toHaveText(HE.transposeUpGlyph);
    await expect(tid("transpose-up")).toHaveText("+");
  });
});
