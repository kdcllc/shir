import { $$, browser, expect } from "@wdio/globals";
import { EN } from "../../apps/desktop/src/i18n/en";
import { relaunch, tid, waitForShell } from "../src/harness";
import { LANGS } from "../src/launch";
import { createSong, textsOf } from "../src/ui";

const HEBREW_TITLE = "שיר הבוקר";
const ENGLISH_TITLE = "Open Road Probe";
const HEBREW_SONG = `{title: ${HEBREW_TITLE}}\n{artist: זמר}\n{key: Am}\n\n[Am]אור בבוקר על [F]הדרך`;
const ENGLISH_SONG = `{title: ${ENGLISH_TITLE}}\n{artist: Anne Singer}\n{key: C}\n\n[C]Morning [G]light on an open road`;
const SETLIST_NAME = "סט הערב";

const COPY_PREFIX = `${SETLIST_NAME} ${EN.duplicateSuffix}`;

async function entryTitles(): Promise<string[]> {
  return textsOf("setlist-entry-title");
}

/** Clicks the Setlists tab, retrying a dropped click until the panel shows. */
async function openSetlistsTab(): Promise<void> {
  await browser.waitUntil(
    async () => {
      await tid("tab-setlists").click();
      return tid("setlists-panel").isExisting();
    },
    { timeoutMsg: "the setlists panel never opened" },
  );
}

async function openSongsTab(): Promise<void> {
  await tid("tab-songs").click();
  await tid("song-list").waitForExist();
}

/** Opens the song with the given title from the song list. */
async function openSong(title: string): Promise<void> {
  await openSongsTab();
  const index = (await textsOf("song-item")).findIndex((t) =>
    t.includes(title),
  );
  if (index < 0) throw new Error(`song ${title} is not listed`);
  await (await $$('[data-testid="song-item"]'))[index]!.click();
  await expect(tid("song-title")).toHaveText(title);
}

/** Waits until no element with the test id exists (tolerates stale handles). */
async function waitGone(id: string): Promise<void> {
  await browser.waitUntil(async () => !(await tid(id).isExisting()), {
    timeoutMsg: `${id} never went away`,
  });
}

/** Selects the setlist row at `index` and waits for its editor. */
async function selectSetlist(index: number): Promise<void> {
  await openSetlistsTab();
  const buttons = await $$('[data-testid="setlist-select"]');
  await buttons[index]!.click();
  await tid("setlist-editor").waitForExist();
}

async function waitForTitles(expected: string[]): Promise<void> {
  await browser.waitUntil(
    async () =>
      JSON.stringify(await entryTitles()) === JSON.stringify(expected),
    { timeoutMsg: `entries never became ${expected.join(" | ")}` },
  );
}

/** Texts of the setlist select buttons: the name followed by the item count. */
const setlistTexts = () => textsOf("setlist-select");

const setlistCount = async () => (await textsOf("setlist-row")).length;

const isCopy = (text: string) => text.startsWith(COPY_PREFIX);

/** Index of the original (not the copy) setlist row. */
async function originalIndex(): Promise<number> {
  const texts = await setlistTexts();
  return texts.findIndex((t) => t.startsWith(SETLIST_NAME) && !isCopy(t));
}

/** Index of the duplicate setlist row, waiting until it is listed. */
async function copyIndex(): Promise<number> {
  await browser.waitUntil(async () => (await setlistTexts()).some(isCopy), {
    timeoutMsg: "the duplicate setlist is not listed",
  });
  return (await setlistTexts()).findIndex(isCopy);
}

describe("setlist core flow", () => {
  before(async () => {
    await waitForShell();
    await createSong(HEBREW_SONG);
    await createSong(ENGLISH_SONG);
  });

  it("creates a setlist with a Hebrew name", async () => {
    await openSetlistsTab();
    await tid("setlist-name-input").setValue(SETLIST_NAME);
    await tid("setlist-create").click();
    await tid("setlist-editor").waitForExist();
    expect(await setlistCount()).toBe(1);
    expect((await setlistTexts())[0]).toContain(SETLIST_NAME);
  });

  it("adds each song through Add to setlist", async () => {
    for (const title of [HEBREW_TITLE, ENGLISH_TITLE]) {
      await openSong(title);
      await tid("song-add-to-setlist").click();
      await tid("add-to-setlist").waitForExist();
      await tid("add-to-setlist-option").click();
      await tid("add-to-setlist-confirm").click();
      await waitGone("add-to-setlist");
    }
    await selectSetlist(0);
    await waitForTitles([HEBREW_TITLE, ENGLISH_TITLE]);
  });

  it("moves the second entry up", async () => {
    const ups = await $$('[data-testid="setlist-entry-up"]');
    await ups[1]!.click();
    await waitForTitles([ENGLISH_TITLE, HEBREW_TITLE]);
  });

  it("raises the first entry's transpose by 2 and sets the other capo", async () => {
    const ups = await $$('[data-testid="setlist-entry-transpose-up"]');
    expect((await textsOf("setlist-entry-key"))[0]).toBe("C");
    await ups[0]!.click();
    await browser.waitUntil(
      async () => (await textsOf("setlist-entry-transpose-value"))[0] === "+1",
    );
    await ups[0]!.click();
    await browser.waitUntil(
      async () => (await textsOf("setlist-entry-transpose-value"))[0] === "+2",
    );
    // C transposed by +2 sounds as D.
    await browser.waitUntil(
      async () => (await textsOf("setlist-entry-key"))[0] === "D",
    );
    const capos = await $$('[data-testid="setlist-entry-capo"]');
    await capos[1]!.selectByAttribute("value", "3");
    await expect(capos[1]!).toHaveValue("3");
  });

  it("keeps the setlist, order, transpose and capo after a restart", async () => {
    await relaunch({ lang: LANGS.en });
    await selectSetlist(0);
    expect(await setlistCount()).toBe(1);
    expect((await setlistTexts())[0]).toContain(SETLIST_NAME);
    await waitForTitles([ENGLISH_TITLE, HEBREW_TITLE]);
    expect(await textsOf("setlist-entry-transpose-value")).toEqual(["+2", "0"]);
    expect((await textsOf("setlist-entry-key"))[0]).toBe("D");
    const capos = await $$('[data-testid="setlist-entry-capo"]');
    await expect(capos[1]!).toHaveValue("3");
    await expect(capos[0]!).toHaveValue("");
  });

  it("duplicates the setlist with the same entries", async () => {
    await (await $$('[data-testid="setlist-duplicate"]'))[0]!.click();
    const copy = await copyIndex();
    expect(await setlistCount()).toBe(2);
    await selectSetlist(copy);
    await waitForTitles([ENGLISH_TITLE, HEBREW_TITLE]);
    expect(await textsOf("setlist-entry-transpose-value")).toEqual(["+2", "0"]);
    const capos = await $$('[data-testid="setlist-entry-capo"]');
    await expect(capos[1]!).toHaveValue("3");
  });

  it("removes a deleted song's entry from both setlists", async () => {
    await openSong(ENGLISH_TITLE);
    await tid("delete-song").click();
    await tid("confirm-delete").waitForExist();
    await tid("confirm-delete-yes").click();
    await waitGone("confirm-delete");
    await browser.waitUntil(
      async () =>
        !(await textsOf("song-item")).some((t) => t.includes(ENGLISH_TITLE)),
      { timeoutMsg: "the deleted song is still listed" },
    );
    for (const index of [0, 1]) {
      await selectSetlist(index);
      await waitForTitles([HEBREW_TITLE]);
    }
  });

  it("deletes the duplicate and leaves the original intact", async () => {
    await openSetlistsTab();
    const copy = await copyIndex();
    await (await $$('[data-testid="setlist-delete"]'))[copy]!.click();
    await tid("confirm-delete-setlist").waitForExist();
    await tid("confirm-delete-setlist-yes").click();
    await waitGone("confirm-delete-setlist");
    await browser.waitUntil(async () => (await setlistCount()) === 1);
    await selectSetlist(await originalIndex());
    await waitForTitles([HEBREW_TITLE]);
    const [only] = await setlistTexts();
    expect(only).toContain(SETLIST_NAME);
    expect(isCopy(only!)).toBe(false);
  });
});
