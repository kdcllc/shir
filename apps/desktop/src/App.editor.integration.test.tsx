import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { parseSong, serializeSong, splitGraphemes } from "chord-core";
import type { SongModel } from "chord-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { pickSongFiles, readTextFile } from "./files";
import { loadLibrary } from "./library";
import {
  deleteSong,
  getSong,
  listSongs,
  saveSong,
  searchSongs,
} from "./storage";
import type { Song, SongSummary } from "./storage";
import {
  STRINGS,
  deleteConfirmTitle,
  deleteManyTitle,
  deletedCount,
  selectedCount,
} from "./strings";

vi.mock("./uiReady", () => ({ signalUiReady: vi.fn() }));
vi.mock("./storage", () => ({
  listSongs: vi.fn(),
  getSong: vi.fn(),
  searchSongs: vi.fn(),
  saveSong: vi.fn(),
  deleteSong: vi.fn(),
}));
vi.mock("./files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./files")>()),
  pickSongFiles: vi.fn(),
  readTextFile: vi.fn(),
}));

function fixtureText(name: string): string {
  const entry = loadLibrary().find((s) => s.id === `test-songs:${name}`);
  if (entry === undefined) throw new Error(`no fixture ${name}`);
  return serializeSong(entry.song);
}

const ALPHA = "{title: Alpha}\n[C]Alpha [G]line here\n";
const BETA = "{title: Beta}\n{key: Am}\n[Am]Beta [G]line\n";
const SHIR = "{title: שיר}\n[C]שלום [G]לכם\n";
const NIQQUD = fixtureText("he_niqqud");
const NIQQUD_TITLE = "שיר השלום";
const MIXED = fixtureText("mixed_he_en");
const MIXED_TITLE = "רוק בבוקר";

/** Chords over lyrics, Hebrew: the importer needs an alignment review. */
const HE_SHEET = "Am      G\nשלום עולם יפה\n";
const HE_MIRROR = "שלום [G]עולם י[Am]פה";
const HE_LOGICAL = "[Am]שלום עול[G]ם יפה";
/** The same sheet with a third chord far past the end of the lyric. */
const HE_SHEET_LONG = "Am      G                         C\nשלום עולם יפה\n";

function stored(id: string, chordpro: string): Song {
  return { id, chordpro, createdAt: "", updatedAt: "" } as unknown as Song;
}

function titleOf(chordpro: string): string {
  return parseSong(chordpro).song.title?.trim() ?? "";
}

function parsed(text: string): SongModel {
  return parseSong(text).song;
}

// ---- the mocked database -----------------------------------------------------------------

/** Song id -> ChordPro text; `listSongs` derives its summaries from it. */
const db = new Map<string, string>();
let nextId = 0;

function summaries(): SongSummary[] {
  return [...db].map(
    ([id, chordpro]) =>
      ({
        id,
        title: titleOf(chordpro),
        artist: null,
        key: null,
        language: "en",
        updatedAt: "2026-01-01T00:00:00Z",
      }) as SongSummary,
  );
}

// ---- page helpers ------------------------------------------------------------------------

const byId = (id: string) => screen.getByTestId(id);
const click = (id: string) => fireEvent.click(byId(id));
const songTitle = () => screen.getByTestId("song-title").textContent;

function titles(): string[] {
  return screen
    .queryAllByTestId("song-item")
    .map((el) => el.querySelector("span")?.textContent ?? "");
}

function songRowIndex(title: string): number {
  const at = titles().indexOf(title);
  if (at === -1) throw new Error(`no song ${title} in ${titles().join()}`);
  return at;
}

async function renderDb() {
  render(<App />);
  await screen.findByTestId("song-index");
  await screen.findByTestId("song-title");
}

/** Selects a song in the list and waits for its pane. */
async function openSong(title: string) {
  fireEvent.click(screen.getAllByTestId("song-item")[songRowIndex(title)]!);
  await waitFor(() => expect(songTitle()).toBe(title));
}

/** Opens the editor on the song with this title. */
async function editSong(title: string) {
  await openSong(title);
  click("edit-song");
  await screen.findByTestId("editor");
  expect(byId("editor-tab-visual")).toHaveAttribute("aria-selected", "true");
}

function find(root: ParentNode, selector: string): HTMLElement {
  const el = root.querySelector(selector);
  if (!(el instanceof HTMLElement)) throw new Error(`no ${selector}`);
  return el;
}

const row = (i: number) =>
  find(document, `[data-testid="visual-line"][data-line-index="${i}"]`);
const pos = (i: number, index: number) => find(row(i), `[data-pos="${index}"]`);
const chordButton = (i: number, anchor: number) =>
  find(row(i), `[data-chord-button][data-anchor-index="${anchor}"]`);
const chordInput = () => screen.getByTestId<HTMLInputElement>("chord-input");

/** The chords a row shows, each with the grapheme position it stands over. */
function shownChords(i: number): string[] {
  return [...row(i).querySelectorAll("[data-pos][data-anchor]")].flatMap((el) =>
    [...el.querySelectorAll("[data-chord-button]")].map(
      (b) => `${b.textContent ?? ""}@${el.getAttribute("data-pos") ?? ""}`,
    ),
  );
}

/** The lyric a row shows: its grapheme positions in logical order. */
function shownLyric(i: number): string {
  return [...row(i).querySelectorAll("[data-pos]")]
    .map((el) =>
      [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? "")
        .join(""),
    )
    .join("");
}

function lyricRowIndices(): number[] {
  return screen
    .getAllByTestId("visual-line")
    .filter(
      (el) =>
        el.getAttribute("data-kind") === "lyric" &&
        !el.hasAttribute("data-phantom"),
    )
    .map((el) => Number(el.getAttribute("data-line-index")));
}

function typeChord(chord: string) {
  fireEvent.change(chordInput(), { target: { value: chord } });
  fireEvent.keyDown(chordInput(), { key: "Enter" });
}

/** Sets the lyric of row `i` through its text field, committed by blur. */
function editLyric(i: number, value: string) {
  fireEvent.click(within(row(i)).getByTestId("line-edit-text"));
  const input = within(row(i)).getByTestId<HTMLInputElement>("line-input");
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

const sourceInput = () =>
  screen.getByTestId<HTMLTextAreaElement>("editor-input");

/** The editor text as the Source tab shows it; returns to the Visual tab. */
function textNow(): string {
  click("editor-tab-source");
  const value = sourceInput().value;
  click("editor-tab-visual");
  return value;
}

async function save(): Promise<[string, string | undefined]> {
  const before = vi.mocked(saveSong).mock.calls.length;
  click("editor-save");
  await waitFor(() => expect(saveSong).toHaveBeenCalledTimes(before + 1));
  await waitFor(() => expect(screen.queryByTestId("editor")).toBeNull());
  const call = vi.mocked(saveSong).mock.calls[before]!;
  return [call[0], call[1]];
}

function mockClipboard(text: string) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { readText: () => Promise.resolve(text) },
  });
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  db.clear();
  // Title order is שיר, שיר השלום, Alpha, Beta: the app opens שיר first.
  db.set("b", BETA);
  db.set("a", ALPHA);
  db.set("c", SHIR);
  db.set("n", NIQQUD);
  nextId = 0;
  vi.mocked(listSongs).mockReset();
  vi.mocked(getSong).mockReset();
  vi.mocked(searchSongs).mockReset();
  vi.mocked(saveSong).mockReset();
  vi.mocked(deleteSong).mockReset();
  vi.mocked(pickSongFiles).mockReset();
  vi.mocked(readTextFile).mockReset();
  vi.mocked(listSongs).mockImplementation(() => Promise.resolve(summaries()));
  vi.mocked(getSong).mockImplementation((id) => {
    const text = db.get(id);
    return text === undefined
      ? Promise.reject(new Error(`no song ${id}`))
      : Promise.resolve(stored(id, text));
  });
  vi.mocked(saveSong).mockImplementation((chordpro, id) => {
    const key = id ?? `new${++nextId}`;
    db.set(key, chordpro);
    return Promise.resolve(stored(key, chordpro));
  });
  vi.mocked(deleteSong).mockImplementation((id) => {
    db.delete(id);
    return Promise.resolve();
  });
});

afterEach(() => {
  expect(errorSpy).not.toHaveBeenCalled();
  errorSpy.mockRestore();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("the mocked library", () => {
  it("lists the four songs by title and opens the first", async () => {
    await renderDb();
    expect(titles()).toEqual(["שיר", NIQQUD_TITLE, "Alpha", "Beta"]);
    expect(songTitle()).toBe("שיר");
    expect(saveSong).not.toHaveBeenCalled();
    expect(deleteSong).not.toHaveBeenCalled();
  });
});

describe("visual editing through the mounted App", () => {
  it("new song, Hebrew: title, lyric typed in the phantom row, chord picked at a clicked position, saved without an id", async () => {
    await renderDb();
    click("new-song");
    await screen.findByTestId("editor");
    expect(byId("visual-hint").textContent).toBe(STRINGS.visualHint);

    const title = byId("meta-title");
    fireEvent.change(title, { target: { value: "שיר חדש" } });
    fireEvent.blur(title);

    // The title is line 0; the phantom row after it is line 1.
    const phantom = find(document, '[data-testid="visual-line"][data-phantom]');
    expect(phantom.getAttribute("data-line-index")).toBe("1");
    fireEvent.click(find(phantom, "[data-row-focus]"));
    const input = within(phantom).getByTestId<HTMLInputElement>("line-input");
    expect(input).toHaveAttribute("dir", "auto");
    fireEvent.change(input, { target: { value: "בוקר טוב עולם" } });
    fireEvent.blur(input);

    expect(screen.queryByTestId("visual-hint")).toBeNull();
    expect(shownLyric(1)).toBe("בוקר טוב עולם");
    expect(row(1)).not.toHaveAttribute("data-phantom");
    expect(shownChords(1)).toEqual([]);

    // Grapheme 5 is the first letter of the second word.
    expect(pos(1, 5).textContent).toBe("ט");
    fireEvent.click(pos(1, 5));
    expect(row(1)).toContainElement(byId("chord-picker"));
    typeChord("Am");
    expect(screen.queryByTestId("chord-picker")).toBeNull();
    expect(shownChords(1)).toEqual(["Am@5"]);

    const [text, id] = await save();
    expect(id).toBeUndefined();
    expect(text).toBe("{title: שיר חדש}\nבוקר [Am]טוב עולם\n");
    const song = parsed(text);
    expect(song.title).toBe("שיר חדש");
    expect(song.lines[1]).toEqual({
      kind: "lyric",
      lyric: "בוקר טוב עולם",
      chords: [{ index: 5, chord: "Am" }],
    });
    expect(saveSong).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(songTitle()).toBe("שיר חדש"));
    expect(titles()).toContain("שיר חדש");
  });

  it("existing English song: a chord moved right and another changed through the picker are saved under the song id", async () => {
    await renderDb();
    await editSong("Alpha");
    expect(shownLyric(1)).toBe("Alpha line here");
    expect(shownChords(1)).toEqual(["C@0", "G@6"]);

    fireEvent.click(chordButton(1, 1));
    expect(chordInput()).toHaveValue("G");
    click("chord-move-right");
    expect(shownChords(1)).toEqual(["C@0", "G@7"]);
    // The picker follows the moved chord.
    expect(chordInput()).toHaveValue("G");

    fireEvent.click(chordButton(1, 0));
    expect(chordInput()).toHaveValue("C");
    fireEvent.change(chordInput(), { target: { value: "Am" } });
    expect(byId("chord-warning").textContent).toBe("");
    click("chord-apply");
    expect(screen.queryByTestId("chord-picker")).toBeNull();
    expect(shownChords(1)).toEqual(["Am@0", "G@7"]);

    const [text, id] = await save();
    expect(text).toBe("{title: Alpha}\n[Am]Alpha l[G]ine here\n");
    expect(id).toBe("a");
    expect(saveSong).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(songTitle()).toBe("Alpha"));
  });

  it("existing Hebrew song: move left walks to the next graphemes and on to the end slot at the left end", async () => {
    await renderDb();
    await editSong("שיר");
    expect(byId("editor-visual")).toHaveAttribute("dir", "auto");
    expect(shownLyric(1)).toBe("שלום לכם");
    expect(shownChords(1)).toEqual(["C@0", "G@5"]);

    fireEvent.click(chordButton(1, 1));
    click("chord-move-left");
    expect(shownChords(1)).toEqual(["C@0", "G@6"]);
    click("chord-move-left");
    expect(shownChords(1)).toEqual(["C@0", "G@7"]);
    // Left of the last letter of an RTL line is its end position (8 graphemes).
    click("chord-move-left");
    expect(shownChords(1)).toEqual(["C@0", "G@8"]);
    expect(pos(1, 8)).toHaveAttribute("data-end-slot");
    // The visual left end: one more step changes nothing.
    click("chord-move-left");
    expect(shownChords(1)).toEqual(["C@0", "G@8"]);
    click("chord-move-right");
    expect(shownChords(1)).toEqual(["C@0", "G@7"]);

    // Position 0 is the visual right end of an RTL line: C cannot move right.
    fireEvent.click(chordButton(1, 0));
    expect(chordInput()).toHaveValue("C");
    click("chord-move-right");
    expect(shownChords(1)).toEqual(["C@0", "G@7"]);
    click("chord-close");

    const [text, id] = await save();
    expect(text).toBe("{title: שיר}\n[C]שלום לכ[G]ם\n");
    expect(id).toBe("c");
  });

  it("mixed Hebrew and English line: a chord at the start of the English phrase moves left to the Hebrew after the phrase", async () => {
    db.set("m", MIXED);
    await renderDb();
    await editSong(MIXED_TITLE);
    const [first] = lyricRowIndices();
    if (first === undefined) throw new Error("no lyric row");
    const line = parsed(MIXED).lines[first];
    if (line?.kind !== "lyric") throw new Error("not a lyric line");
    expect(line.lyric.indexOf("rock and roll")).toBe(11);
    expect(shownChords(first)).toEqual(["Am@0", "G@11", "F@21"]);

    // On screen the phrase reads left to right inside the RTL line: left of
    // its first letter (11) is the space after the phrase (24), not index 10.
    fireEvent.click(chordButton(first, 1));
    expect(chordInput()).toHaveValue("G");
    click("chord-move-left");
    expect(shownChords(first)).toEqual(["Am@0", "F@21", "G@24"]);
    click("chord-move-right");
    expect(shownChords(first)).toEqual(["Am@0", "G@11", "F@21"]);
    // Inside the phrase right is the next letter.
    click("chord-move-right");
    expect(shownChords(first)).toEqual(["Am@0", "G@12", "F@21"]);
    click("chord-close");

    const [text, id] = await save();
    expect(id).toBe("m");
    expect(text.split("\n")[first]).toBe(
      "[Am]אנחנו שרים r[G]ock and r[F]oll עד הבוקר",
    );
  });

  it("niqqud song: a chord added at a clicked position lands between whole graphemes", async () => {
    await renderDb();
    await editSong(NIQQUD_TITLE);
    const [first] = lyricRowIndices();
    if (first === undefined) throw new Error("no lyric row");
    const line = parsed(NIQQUD).lines[first];
    if (line?.kind !== "lyric") throw new Error("not a lyric line");
    const graphemes = splitGraphemes(line.lyric);
    // Grapheme 0 is a letter with two marks, grapheme 2 a letter with one.
    expect(graphemes[0]!.length).toBe(3);
    expect(graphemes[2]!.length).toBe(2);
    expect(shownLyric(first)).toBe(line.lyric);
    expect(pos(first, 2).textContent).toBe(graphemes[2]);

    fireEvent.click(pos(first, 2));
    typeChord("C");
    fireEvent.click(pos(first, 3));
    // A suggestion: the chords the song already uses.
    const options = screen.getAllByTestId("chord-option");
    expect(options.map((o) => o.textContent)).toContain("Dm");
    fireEvent.click(options.find((o) => o.textContent === "Dm")!);

    const [text, id] = await save();
    expect(id).toBe("n");
    const saved = parsed(text).lines[first];
    if (saved?.kind !== "lyric") throw new Error("saved line is not a lyric");
    expect(saved.lyric).toBe(line.lyric);
    expect(saved.chords).toEqual([
      { index: 0, chord: "Am" },
      { index: 2, chord: "C" },
      { index: 3, chord: "Dm" },
      ...line.chords.slice(1),
    ]);
    expect(text.split("\n")[first]).toBe(
      `[Am]${graphemes.slice(0, 2).join("")}[C]${graphemes[2]!}[Dm]${graphemes
        .slice(3, line.chords[1]!.index)
        .join("")}[G]${graphemes.slice(line.chords[1]!.index).join("")}`,
    );
    // No chord splits a base letter from its marks.
    expect(/\][֑-ׇ]/u.test(text)).toBe(false);
    // Only that line changed.
    const before = NIQQUD.split("\n");
    const after = text.split("\n");
    expect(after.filter((l, i) => l !== before[i])).toHaveLength(1);
  });

  it("click, click, double click on a lyric row ends in lyric-edit mode with no picker open", async () => {
    await renderDb();
    await editSong("Alpha");
    const target = pos(1, 3);
    fireEvent.click(target);
    expect(byId("chord-picker")).toBeInTheDocument();
    fireEvent.click(pos(1, 3));
    fireEvent.doubleClick(pos(1, 3));
    expect(screen.queryByTestId("chord-picker")).toBeNull();
    const input = within(row(1)).getByTestId<HTMLInputElement>("line-input");
    expect(input).toHaveValue("Alpha line here");
    expect(input).toHaveFocus();
    fireEvent.blur(input);
    // Nothing was edited on the way.
    expect(byId("editor-undo")).toBeDisabled();
    expect(textNow()).toBe(ALPHA);
  });
});

describe("Visual and Source edit one text", () => {
  it("a Visual edit shows in the Source text, a Source edit shows as rows, and Save stores the last text", async () => {
    await renderDb();
    await editSong("Alpha");

    // "Alpha line here": grapheme 11 is the h of "here".
    fireEvent.click(pos(1, 11));
    typeChord("F");
    expect(shownChords(1)).toEqual(["C@0", "G@6", "F@11"]);

    click("editor-tab-source");
    expect(byId("editor-source")).toBeInTheDocument();
    expect(screen.queryByTestId("editor-visual")).toBeNull();
    const afterVisual = "{title: Alpha}\n[C]Alpha [G]line [F]here\n";
    expect(sourceInput().value).toBe(afterVisual);

    const last = `${afterVisual}second [Dm]row\n`;
    fireEvent.change(sourceInput(), { target: { value: last } });

    click("editor-tab-visual");
    expect(screen.queryByTestId("editor-source")).toBeNull();
    expect(lyricRowIndices()).toEqual([1, 2]);
    expect(shownLyric(2)).toBe("second row");
    expect(shownChords(2)).toEqual(["Dm@7"]);
    expect(shownChords(1)).toEqual(["C@0", "G@6", "F@11"]);

    const [text, id] = await save();
    expect(text).toBe(last);
    expect(id).toBe("a");
  });

  it("undo and redo run across both tabs, and undoing back to the opened text leaves the editor clean", async () => {
    await renderDb();
    await editSong("Alpha");
    expect(byId("editor-undo")).toBeDisabled();
    expect(byId("editor-redo")).toBeDisabled();

    editLyric(1, "Alpha line there");
    const afterVisual = "{title: Alpha}\n[C]Alpha [G]line there\n";
    click("editor-tab-source");
    expect(sourceInput().value).toBe(afterVisual);
    const afterSource = `${afterVisual}more\n`;
    fireEvent.change(sourceInput(), { target: { value: afterSource } });

    // Undo the Source edit while on Source, then the Visual edit while on Visual.
    click("editor-undo");
    expect(sourceInput().value).toBe(afterVisual);
    click("editor-tab-visual");
    expect(shownLyric(1)).toBe("Alpha line there");
    click("editor-undo");
    expect(shownLyric(1)).toBe("Alpha line here");
    expect(byId("editor-undo")).toBeDisabled();
    expect(byId("editor-redo")).toBeEnabled();

    // Redo the Visual edit on Source, the Source edit on Visual.
    click("editor-tab-source");
    expect(sourceInput().value).toBe(ALPHA);
    click("editor-redo");
    expect(sourceInput().value).toBe(afterVisual);
    click("editor-tab-visual");
    click("editor-redo");
    expect(lyricRowIndices()).toEqual([1, 2]);
    expect(shownLyric(2)).toBe("more");
    expect(byId("editor-redo")).toBeDisabled();

    // Dirty now: leaving asks. Keep editing, undo everything, then leaving is silent.
    fireEvent.click(screen.getAllByTestId("song-item")[songRowIndex("Beta")]!);
    expect(await screen.findByTestId("confirm-discard")).toBeInTheDocument();
    click("confirm-keep");
    click("editor-undo");
    click("editor-undo");
    expect(byId("editor-undo")).toBeDisabled();
    expect(textNow()).toBe(ALPHA);

    fireEvent.click(screen.getAllByTestId("song-item")[songRowIndex("Beta")]!);
    await waitFor(() => expect(songTitle()).toBe("Beta"));
    expect(screen.queryByTestId("confirm-discard")).toBeNull();
    expect(screen.queryByTestId("editor")).toBeNull();
    expect(saveSong).not.toHaveBeenCalled();
  });

  it("Ctrl+Y redoes, Cmd+Y does not", async () => {
    await renderDb();
    await editSong("Alpha");
    editLyric(1, "Alpha line there");
    click("editor-undo");
    expect(shownLyric(1)).toBe("Alpha line here");
    expect(byId("editor-redo")).toBeEnabled();

    fireEvent.keyDown(byId("editor-visual"), { key: "y", metaKey: true });
    expect(shownLyric(1)).toBe("Alpha line here");
    expect(byId("editor-redo")).toBeEnabled();

    fireEvent.keyDown(byId("editor-visual"), { key: "y", ctrlKey: true });
    expect(shownLyric(1)).toBe("Alpha line there");
    expect(byId("editor-redo")).toBeDisabled();
  });
});

describe("unsaved-changes guard with visual edits", () => {
  it("a visual edit, then another song: the confirmation shows, and Keep editing preserves the edit", async () => {
    await renderDb();
    await editSong("Alpha");

    fireEvent.click(chordButton(1, 0));
    click("chord-remove");
    expect(shownChords(1)).toEqual(["G@6"]);
    const getCalls = vi.mocked(getSong).mock.calls.length;

    fireEvent.click(screen.getAllByTestId("song-item")[songRowIndex("Beta")]!);
    const dialog = await screen.findByTestId("confirm-discard");
    expect(dialog).toHaveAttribute("role", "alertdialog");
    expect(byId("editor")).toBeInTheDocument();
    expect(byId("confirm-discard-yes")).toBeInTheDocument();

    click("confirm-keep");
    expect(screen.queryByTestId("confirm-discard")).toBeNull();
    expect(byId("editor")).toBeInTheDocument();
    expect(shownChords(1)).toEqual(["G@6"]);
    expect(shownLyric(1)).toBe("Alpha line here");
    // Beta was not loaded and nothing was saved.
    expect(getSong).toHaveBeenCalledTimes(getCalls);
    expect(saveSong).not.toHaveBeenCalled();

    const [text, id] = await save();
    expect(text).toBe("{title: Alpha}\nAlpha [G]line here\n");
    expect(id).toBe("a");
  });

  it("an untouched editor leaves without a confirmation", async () => {
    await renderDb();
    await editSong("Alpha");
    fireEvent.click(chordButton(1, 0));
    click("chord-close");
    await openSong("Beta");
    expect(screen.queryByTestId("confirm-discard")).toBeNull();
    expect(screen.queryByTestId("editor")).toBeNull();
  });
});

describe("queued import review", () => {
  it("an RTL chords-over-lyrics .txt opens in the Visual tab for review; Flip changes the chord positions shown; Save stores it", async () => {
    vi.mocked(pickSongFiles).mockResolvedValue(["/m/he.txt"]);
    vi.mocked(readTextFile).mockResolvedValue(HE_SHEET);
    await renderDb();

    click("open-files");
    const visual = await screen.findByTestId("editor-visual");
    expect(byId("editor-tab-visual")).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("editor-source")).toBeNull();
    expect(byId("reviewing-file").textContent).toContain("he.txt");
    expect(byId("import-queued").textContent).toBe(
      "1 file needs alignment review",
    );
    expect(byId("editor-flip").textContent).toBe(STRINGS.flipAlignment);
    // Nothing is saved before the review.
    expect(saveSong).not.toHaveBeenCalled();
    expect(visual).toContainElement(row(1));
    expect(byId("meta-title")).toHaveValue("he");

    expect(shownLyric(1)).toBe("שלום עולם יפה");
    expect(shownChords(1)).toEqual(["G@5", "Am@11"]);
    expect(textNow()).toBe(`{title: he}\n${HE_MIRROR}\n`);

    click("editor-flip");
    expect(shownChords(1)).toEqual(["Am@0", "G@8"]);
    expect(shownLyric(1)).toBe("שלום עולם יפה");
    expect(byId("editor-flip")).toBeInTheDocument();

    const [text, id] = await save();
    expect(text).toBe(`{title: he}\n${HE_LOGICAL}\n`);
    expect(id).toBeUndefined();
    expect(saveSong).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(songTitle()).toBe("he"));
    expect(screen.queryByTestId("reviewing-file")).toBeNull();
  });

  it("lists the import warnings of the queued file above the rows", async () => {
    vi.mocked(pickSongFiles).mockResolvedValue(["/m/long.txt"]);
    vi.mocked(readTextFile).mockResolvedValue(HE_SHEET_LONG);
    await renderDb();

    click("open-files");
    await screen.findByTestId("editor-visual");
    expect(byId("reviewing-file").textContent).toContain("long.txt");
    const warnings = within(byId("import-warnings")).getAllByTestId(
      "import-warning",
    );
    expect(warnings).toHaveLength(1);
    // The warning names line 1 of the file, the chord line.
    expect(warnings[0]!.querySelector("bdi")?.textContent).toBe("1");
    expect(warnings[0]!.querySelector("span")?.textContent).not.toBe("");
    expect(byId("editor-flip")).toBeInTheDocument();
    // All three chords are kept and shown.
    expect(
      shownChords(1)
        .map((c) => c.split("@")[0])
        .sort(),
    ).toEqual(["Am", "C", "G"]);

    const [text] = await save();
    expect(text.startsWith("{title: long}\n")).toBe(true);
    expect([...text.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]).sort()).toEqual(
      ["Am", "C", "G"],
    );
  });

  it("Cancel skips the queued file without saving it", async () => {
    vi.mocked(pickSongFiles).mockResolvedValue(["/m/he.txt"]);
    vi.mocked(readTextFile).mockResolvedValue(HE_SHEET);
    await renderDb();
    click("open-files");
    await screen.findByTestId("editor-visual");

    click("editor-cancel");
    click("confirm-discard-yes");
    await waitFor(() => expect(screen.queryByTestId("editor")).toBeNull());
    expect(saveSong).not.toHaveBeenCalled();
    expect(
      within(byId("import-skipped")).getByText("he.txt"),
    ).toBeInTheDocument();
    expect(byId("import-summary").textContent).toBe("Imported 0 of 1 file");
  });
});

describe("editor shell", () => {
  it("permanent transpose: Save stores the transposed chords and key", async () => {
    await renderDb();
    await editSong("Beta");
    expect(byId("meta-key")).toHaveValue("Am");
    expect(shownChords(2)).toEqual(["Am@0", "G@5"]);

    click("editor-transpose-up");
    expect(shownChords(2)).toEqual(["Bbm@0", "Ab@5"]);
    expect(byId("meta-key")).toHaveValue("Bbm");

    const [text, id] = await save();
    expect(text).toBe("{title: Beta}\n{key: Bbm}\n[Bbm]Beta [Ab]line\n");
    expect(id).toBe("b");
    const song = parsed(text);
    expect(song.key).toBe("Bbm");
    // The stored song is transposed: the viewer shows it without a view transpose.
    await waitFor(() => expect(byId("sounding-key").textContent).toBe("Bbm"));
    expect(byId("transpose-value").textContent).toBe("0");
  });

  it("transpose down then up restores the opened text: nothing to discard", async () => {
    await renderDb();
    await editSong("Beta");
    click("editor-transpose-down");
    expect(shownChords(2)).toEqual(["G#m@0", "F#@5"]);
    click("editor-transpose-up");
    expect(textNow()).toBe(BETA);
    await openSong("Alpha");
    expect(screen.queryByTestId("confirm-discard")).toBeNull();
  });

  it("a whitespace-only change of a chords line after an RTL paste keeps Flip and records no undo step", async () => {
    mockClipboard(`${HE_SHEET}\nC  D\n`);
    await renderDb();
    click("new-song");
    await screen.findByTestId("editor");
    click("editor-paste");
    await screen.findByTestId("editor-flip");
    const pasted = textNow();
    expect(pasted).toBe(`${HE_MIRROR}\n\n[C] [D]\n`);

    const chords = byId("chords-input") as HTMLInputElement;
    expect(chords).toHaveValue("C D");
    fireEvent.change(chords, { target: { value: "  C    D " } });
    fireEvent.blur(chords);

    expect(byId("editor-flip")).toBeInTheDocument();
    expect(textNow()).toBe(pasted);
    // The paste is the only step: one undo empties the editor and none is left.
    click("editor-undo");
    expect(byId("editor-undo")).toBeDisabled();
    expect(textNow()).toBe("");
  });

  it("a real change of the chords line is one undo step and hides Flip", async () => {
    mockClipboard(`${HE_SHEET}\nC  D\n`);
    await renderDb();
    click("new-song");
    await screen.findByTestId("editor");
    click("editor-paste");
    await screen.findByTestId("editor-flip");

    const chords = byId("chords-input") as HTMLInputElement;
    fireEvent.change(chords, { target: { value: "C Em D" } });
    fireEvent.blur(chords);
    expect(screen.queryByTestId("editor-flip")).toBeNull();
    expect(textNow()).toBe(`${HE_MIRROR}\n\n[C] [Em] [D]\n`);
    click("editor-undo");
    expect(textNow()).toBe(`${HE_MIRROR}\n\n[C] [D]\n`);
    expect(byId("editor-undo")).toBeEnabled();
  });
});

// ---- delete ------------------------------------------------------------------------------

const status = () => byId("delete-status").textContent;
const rowDelete = (title: string) =>
  screen.getAllByTestId("song-delete")[songRowIndex(title)]!;
const check = (title: string) =>
  screen.getAllByTestId("song-check")[songRowIndex(title)]!;
const dialogTitle = () =>
  within(byId("confirm-delete")).getByRole("heading", { level: 2 }).textContent;

/** Resolves once the delete run finished and the controls are enabled again. */
async function settled() {
  await waitFor(() => expect(byId("select-songs")).toBeEnabled());
  await waitFor(() => {
    for (const el of screen.queryAllByTestId("song-delete"))
      expect(el).toBeEnabled();
  });
}

describe("delete flows", () => {
  it("from a row: nothing is deleted before the confirmation, then exactly that song", async () => {
    await renderDb();
    fireEvent.click(rowDelete("Alpha"));
    expect(byId("confirm-delete")).toHaveAttribute("role", "alertdialog");
    expect(dialogTitle()).toBe(deleteConfirmTitle("Alpha"));
    expect(deleteSong).not.toHaveBeenCalled();
    expect(titles()).toEqual(["שיר", NIQQUD_TITLE, "Alpha", "Beta"]);

    click("confirm-delete-yes");
    expect(screen.queryByTestId("confirm-delete")).toBeNull();
    await waitFor(() =>
      expect(titles()).toEqual(["שיר", NIQQUD_TITLE, "Beta"]),
    );
    await settled();
    expect(deleteSong).toHaveBeenCalledExactlyOnceWith("a");
    expect(status()).toBe(deletedCount(1));
    expect(status()).toBe("Deleted 1 song");
    // The open song was not the deleted one: it stays open.
    expect(songTitle()).toBe("שיר");
    expect(screen.queryByTestId("app-notice")).toBeNull();
  });

  it("from a row, cancelled: the song stays", async () => {
    await renderDb();
    fireEvent.click(rowDelete("Beta"));
    click("confirm-delete-cancel");
    expect(screen.queryByTestId("confirm-delete")).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(deleteSong).not.toHaveBeenCalled();
    expect(titles()).toEqual(["שיר", NIQQUD_TITLE, "Alpha", "Beta"]);
    expect(status()).toBe("");
  });

  it("the open song: after the confirmation it is deleted and the next song opens", async () => {
    await renderDb();
    await openSong("Alpha");
    click("delete-song");
    expect(dialogTitle()).toBe(deleteConfirmTitle("Alpha"));
    expect(deleteSong).not.toHaveBeenCalled();
    expect(songTitle()).toBe("Alpha");

    click("confirm-delete-yes");
    await waitFor(() => expect(songTitle()).toBe("Beta"));
    await settled();
    expect(deleteSong).toHaveBeenCalledExactlyOnceWith("a");
    expect(titles()).toEqual(["שיר", NIQQUD_TITLE, "Beta"]);
    const current = screen
      .getAllByTestId("song-item")
      .filter((el) => el.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toContain("Beta");
    expect(status()).toBe("Deleted 1 song");
  });

  it("bulk: two selected songs are deleted after one confirmation, and select mode ends", async () => {
    await renderDb();
    click("select-songs");
    expect(byId("selection-bar")).toContainElement(byId("delete-selected"));
    expect(byId("delete-selected")).toBeDisabled();
    fireEvent.click(check("Alpha"));
    fireEvent.click(check("Beta"));
    expect(byId("selection-count").textContent).toBe(selectedCount(2));
    expect(check("Alpha")).toBeChecked();
    expect(check("שיר")).not.toBeChecked();

    click("delete-selected");
    expect(dialogTitle()).toBe(deleteManyTitle(2));
    expect(deleteSong).not.toHaveBeenCalled();

    click("confirm-delete-yes");
    await waitFor(() => expect(titles()).toEqual(["שיר", NIQQUD_TITLE]));
    await settled();
    expect(
      vi
        .mocked(deleteSong)
        .mock.calls.map((c) => c[0])
        .sort(),
    ).toEqual(["a", "b"]);
    expect(status()).toBe(deletedCount(2));
    expect(status()).toBe("Deleted 2 songs");
    expect(screen.queryAllByTestId("song-check")).toHaveLength(0);
    expect(screen.queryByTestId("select-done")).toBeNull();
    expect(songTitle()).toBe("שיר");
    expect([...db.keys()].sort()).toEqual(["c", "n"]);
  });

  it("bulk, cancelled: nothing is deleted and the selection is kept; Select all and Done work", async () => {
    await renderDb();
    click("select-songs");
    click("select-all");
    expect(byId("selection-count").textContent).toBe(selectedCount(4));
    click("delete-selected");
    expect(dialogTitle()).toBe(deleteManyTitle(4));
    click("confirm-delete-cancel");
    await new Promise((r) => setTimeout(r, 20));
    expect(deleteSong).not.toHaveBeenCalled();
    expect(byId("selection-count").textContent).toBe(selectedCount(4));
    click("select-done");
    expect(screen.queryAllByTestId("song-check")).toHaveLength(0);
    expect(titles()).toHaveLength(4);
  });

  it("deleting the song being edited closes the editor", async () => {
    await renderDb();
    await editSong("Alpha");
    fireEvent.click(rowDelete("Alpha"));
    expect(byId("editor")).toBeInTheDocument();
    expect(deleteSong).not.toHaveBeenCalled();

    click("confirm-delete-yes");
    await waitFor(() => expect(screen.queryByTestId("editor")).toBeNull());
    await settled();
    expect(deleteSong).toHaveBeenCalledExactlyOnceWith("a");
    expect(titles()).toEqual(["שיר", NIQQUD_TITLE, "Beta"]);
    await waitFor(() => expect(songTitle()).toBe("Beta"));
    expect(status()).toBe("Deleted 1 song");
    expect(saveSong).not.toHaveBeenCalled();
    expect(screen.queryByTestId("confirm-discard")).toBeNull();
  });

  it("deleting another song keeps the editor and its unsaved visual edit", async () => {
    await renderDb();
    await editSong("Alpha");
    editLyric(1, "Alpha line there");
    fireEvent.click(rowDelete("Beta"));
    click("confirm-delete-yes");
    await waitFor(() =>
      expect(titles()).toEqual(["שיר", NIQQUD_TITLE, "Alpha"]),
    );
    await settled();
    expect(deleteSong).toHaveBeenCalledExactlyOnceWith("b");
    expect(byId("editor")).toBeInTheDocument();
    expect(shownLyric(1)).toBe("Alpha line there");

    const [text, id] = await save();
    expect(text).toBe("{title: Alpha}\n[C]Alpha [G]line there\n");
    expect(id).toBe("a");
  });
});
