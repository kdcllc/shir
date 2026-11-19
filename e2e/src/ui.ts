import { browser } from "@wdio/globals";
import { tid, waitForShell } from "./harness";

export interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The bounding client rect of `[data-testid="<id>"]`. */
export async function rectOf(id: string): Promise<Rect> {
  return browser.execute((testId: string) => {
    const el = document.querySelector(`[data-testid="${testId}"]`);
    if (el === null) throw new Error(`no element ${testId}`);
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  }, id);
}

/** The `lang` and `dir` attributes of the document element. */
export async function documentLocale(): Promise<{ lang: string; dir: string }> {
  return browser.execute(() => ({
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
  }));
}

/** WebDriver Enter key; a literal "\n" sent to a textarea is dropped by WebKitWebDriver. */
const ENTER = "\uE007";

/** Types `text` into `[data-testid="<id>"]`, sending Enter for each line break. */
export async function typeInto(id: string, text: string): Promise<void> {
  const el = tid(id);
  await el.waitForExist();
  await el.click();
  await el.clearValue();
  await el.addValue(text.split("\n").join(ENTER));
}

/**
 * Creates and saves a song through the UI: New song, Source tab, type the ChordPro
 * text, Save. Leaves the saved song selected.
 */
export async function createSong(chordpro: string): Promise<void> {
  await tid("new-song").click();
  await tid("editor-tab-source").click();
  await typeInto("editor-input", chordpro);
  await tid("editor-save").click();
  await tid("song-header").waitForExist({ timeout: 15_000 });
  await tid("editor").waitForExist({ reverse: true, timeout: 15_000 });
}

/** Texts of every element matching `[data-testid="<id>"]`. */
export async function textsOf(id: string): Promise<string[]> {
  return browser.execute((testId: string) => {
    return Array.from(
      document.querySelectorAll(`[data-testid="${testId}"]`),
    ).map((el) => (el.textContent ?? "").trim());
  }, id);
}

export { waitForShell };
