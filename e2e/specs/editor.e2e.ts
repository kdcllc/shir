import { $, $$, browser, expect } from "@wdio/globals";
import { relaunch, tid, waitForShell } from "../src/harness";
import { typeInto } from "../src/ui";

/** Opens the editor on a new song whose source is `chordpro`, on the Visual tab. */
async function openVisual(chordpro: string): Promise<void> {
  await tid("new-song").click();
  await tid("editor-tab-source").click();
  await typeInto("editor-input", chordpro);
  await tid("editor-tab-visual").click();
  await tid("editor-visual").waitForExist();
}

describe("visual editor in the real engine", () => {
  before(async () => {
    await waitForShell();
  });

  it("F19: a real double-click on a lyric row enters lyric-edit mode without a chord picker", async () => {
    await openVisual(
      "{title: Editor Probe}\n\n[C]Morning [G]light on an open road",
    );
    const row = $(
      '[data-testid="visual-line"][data-kind="lyric"] [data-row-focus]',
    );
    await row.waitForExist();
    await row.doubleClick();
    await tid("line-input").waitForExist({
      timeoutMsg: "lyric-edit mode is not active",
    });
    await expect(tid("chord-picker")).not.toExist();
  });

  it("F54: an open chord picker on the last row does not cover Add section", async () => {
    // A fresh start, so the editor of the previous test holds no unsaved draft.
    await relaunch({ fresh: true });
    // A song that ends with an empty row: the last row before the phantom row.
    await openVisual("{title: Picker Probe}\n\n[C]Hello\n\n");
    const rows = await $$('[data-testid="visual-line"]:not([data-phantom])');
    const last = rows[rows.length - 1]!;
    await last.$('[data-testid="row-add-chord"]').click();
    await tid("chord-picker").waitForExist({
      timeoutMsg: "the chord picker did not open",
    });
    const covered = await browser.execute(() => {
      const button = document.querySelector('[data-testid="add-section"]');
      if (button === null) throw new Error("no add-section button");
      const r = button.getBoundingClientRect();
      const hit = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      );
      return hit === null || !(hit === button || button.contains(hit));
    });
    expect(covered).toBe(false);
  });
});
