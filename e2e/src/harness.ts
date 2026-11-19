import { $, browser } from "@wdio/globals";
import { prepareRelaunch } from "./profile";

/** `[data-testid="<id>"]` as a WebdriverIO element. */
export const tid = (id: string) => $(`[data-testid="${id}"]`);

/** Waits until the library shell has rendered. */
export async function waitForShell(): Promise<void> {
  await tid("song-pane").waitForExist({
    timeout: 30_000,
    timeoutMsg: "the Shir window never rendered the song pane",
  });
  await tid("song-list").waitForExist({ timeout: 30_000 });
}

/**
 * Restarts the app. `fresh` throws the data directories away; otherwise the same
 * directories are reused, which is how persistence across a restart is tested.
 */
export async function relaunch(
  opts: { lang?: string; fresh?: boolean } = {},
): Promise<void> {
  prepareRelaunch(opts);
  await browser.reloadSession();
  await waitForShell();
}
