import { expect } from "@wdio/globals";
import { EN } from "../../apps/desktop/src/i18n/en";
import { HE } from "../../apps/desktop/src/i18n/he";
import { relaunch, tid, waitForShell } from "../src/harness";
import { LANGS } from "../src/launch";
import { documentLocale, rectOf } from "../src/ui";

describe("interface language", () => {
  before(async () => {
    await waitForShell();
  });

  it("starts in English LTR with the sidebar on the left under LANG=en_US", async () => {
    expect(await documentLocale()).toEqual({ lang: "en", dir: "ltr" });
    await expect(tid("new-song")).toHaveText(EN.newSong);
    const sidebar = await rectOf("song-list");
    const pane = await rectOf("song-pane");
    expect(sidebar.right).toBeLessThanOrEqual(pane.left);
  });

  it("switches to Hebrew RTL and mirrors the layout", async () => {
    await tid("locale-he").click();
    expect(await documentLocale()).toEqual({ lang: "he", dir: "rtl" });
    await expect(tid("new-song")).toHaveText(HE.newSong);
    await expect(tid("locale-he")).toHaveAttribute("aria-pressed", "true");
    const sidebar = await rectOf("song-list");
    const pane = await rectOf("song-pane");
    expect(sidebar.left).toBeGreaterThanOrEqual(pane.right);
  });

  it("is still Hebrew after a restart on the same data directories", async () => {
    await relaunch({ lang: LANGS.en });
    expect(await documentLocale()).toEqual({ lang: "he", dir: "rtl" });
    await expect(tid("new-song")).toHaveText(HE.newSong);
  });

  it("switches back to English and that choice survives a restart too", async () => {
    await tid("locale-en").click();
    expect(await documentLocale()).toEqual({ lang: "en", dir: "ltr" });
    await relaunch({ lang: LANGS.he });
    expect(await documentLocale()).toEqual({ lang: "en", dir: "ltr" });
    await expect(tid("new-song")).toHaveText(EN.newSong);
  });

  it("starts in Hebrew on a fresh profile under LANG=he_IL", async () => {
    await relaunch({ lang: LANGS.he, fresh: true });
    expect(await documentLocale()).toEqual({ lang: "he", dir: "rtl" });
    await expect(tid("new-song")).toHaveText(HE.newSong);
    await expect(tid("locale-he")).toHaveAttribute("aria-pressed", "true");
  });
});
