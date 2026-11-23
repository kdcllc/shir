import { $$, browser, expect } from "@wdio/globals";
import { EN } from "../../apps/desktop/src/i18n/en";
import { tid, waitForShell } from "../src/harness";
import { textsOf, typeInto } from "../src/ui";

const HEBREW_TITLE = "שיר הייבוא";
const ENGLISH_TITLE = "Open Road Probe";
const CHORD = "Am";

// Original placeholder lines only. One chord sits inside a Hebrew word.
const HEBREW_SONG = `{title: ${HEBREW_TITLE}}\n{artist: זמר}\n{key: C}\n\nאו[${CHORD}]ר בבוקר על הדרך`;
const ENGLISH_SONG = `{title: ${ENGLISH_TITLE}}\n{artist: Anne Singer}\n{key: C}\n\n[C]Morning [G]light on an open road`;
const REPLY = `Here are the songs:\n\`\`\`chordpro\n${HEBREW_SONG}\n{new_song}\n${ENGLISH_SONG}\n\`\`\``;

/** Reads the editor's source text, switching to the Source tab first. */
async function editorSource(): Promise<string> {
  await tid("editor-tab-source").click();
  const input = tid("editor-input");
  await input.waitForExist();
  return input.getValue();
}

/** Saves the song in the editor and waits until the editor shows different text or closes. */
async function saveAndWaitForNext(previous: string): Promise<void> {
  await tid("editor-save").click();
  await browser.waitUntil(
    async () => {
      if (!(await tid("editor-input").isExisting())) return true;
      return (await tid("editor-input").getValue()) !== previous;
    },
    { timeout: 15_000, timeoutMsg: "the editor did not advance after Save" },
  );
}

describe("Import with AI in the real engine", () => {
  before(async () => {
    await waitForShell();
  });

  it("imports a two-song reply through the paste-back flow", async () => {
    await tid("ai-import").click();
    await tid("ai-import-dialog").waitForDisplayed();
    await expect(tid("ai-source-attach")).toBeSelected();

    const prompt = await tid("ai-prompt").getValue();
    expect(prompt).toContain("{new_song}");

    await tid("ai-copy").click();
    await browser.waitUntil(
      async () =>
        (await tid("ai-copied").isExisting()) ||
        (await tid("ai-copy-failed").isExisting()),
      { timeoutMsg: "neither ai-copied nor ai-copy-failed appeared" },
    );
    const copied = await tid("ai-copied").isExisting();
    if (copied) await expect(tid("ai-copied")).toHaveText(EN.aiCopied);
    else await expect(tid("ai-copy-failed")).toHaveText(EN.aiCopyFailed);
    console.log(
      `ai-import copy result: ${copied ? "ai-copied" : "ai-copy-failed"}`,
    );

    await typeInto("ai-reply", REPLY);
    await tid("ai-parse").click();
    await tid("ai-songs").waitForExist();
    const listed = (await textsOf("ai-song")).join("\n");
    expect(listed).toContain(HEBREW_TITLE);
    expect(listed).toContain(ENGLISH_TITLE);

    await tid("ai-review").click();
    await tid("editor").waitForExist({ timeout: 15_000 });
    const first = await editorSource();
    expect(first).toContain(HEBREW_TITLE);
    await saveAndWaitForNext(first);

    await tid("editor").waitForExist({ timeout: 15_000 });
    const second = await editorSource();
    expect(second).toContain(ENGLISH_TITLE);
    await tid("editor-save").click();
    await tid("editor").waitForExist({ reverse: true, timeout: 15_000 });

    await tid("song-list").waitForExist();
    await browser.waitUntil(
      async () => {
        const titles = (await textsOf("song-item")).join("\n");
        return titles.includes(HEBREW_TITLE) && titles.includes(ENGLISH_TITLE);
      },
      { timeoutMsg: "the library does not list both imported songs" },
    );
  });

  it("renders the Hebrew song's chord as a left-to-right symbol", async () => {
    const items = await textsOf("song-item");
    const matching = items.filter((t) => t.includes(HEBREW_TITLE));
    expect(matching).toHaveLength(1);
    const index = items.findIndex((t) => t.includes(HEBREW_TITLE));
    await (await $$('[data-testid="song-item"]'))[index]!.click();
    await expect(tid("song-title")).toHaveText(HEBREW_TITLE);

    // The selector bdi.chord[dir="ltr"] targets chord symbols only.
    await browser.waitUntil(
      async () => {
        const texts = await browser.execute(() =>
          Array.from(
            document.querySelectorAll(
              '[data-testid="song-pane"] bdi.chord[dir="ltr"]',
            ),
          ).map((el) => (el.textContent ?? "").trim()),
        );
        return texts.includes(CHORD);
      },
      { timeoutMsg: "no ltr bdi chord symbol in the song pane" },
    );
  });
});
