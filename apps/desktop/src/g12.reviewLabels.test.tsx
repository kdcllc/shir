// g12 cross-task (V17): an AI reply from the shared fixture, split by chord-core, is reviewed in
// App with its source and title isolated in two <bdi>. IPC is mocked.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { parseAiReply } from "chord-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { getSong, listSongs, saveSong } from "./storage";
import type { Song } from "./storage";
import { STRINGS } from "./strings";
import { readAiReply } from "../../../packages/test-fixtures/src/index";

vi.mock("./uiReady", () => ({ signalUiReady: vi.fn() }));
vi.mock("./storage", () => ({
  listSongs: vi.fn(),
  getSong: vi.fn(),
  searchSongs: vi.fn(),
  saveSong: vi.fn(),
  deleteSong: vi.fn(),
  listSetlists: vi.fn(() => Promise.resolve([])),
  getSetlist: vi.fn(),
  createSetlist: vi.fn(),
  renameSetlist: vi.fn(),
  deleteSetlist: vi.fn(() => Promise.resolve()),
  duplicateSetlist: vi.fn(),
  addSetlistItems: vi.fn(),
  removeSetlistItem: vi.fn(),
  reorderSetlistItems: vi.fn(),
  updateSetlistItem: vi.fn(),
}));
vi.mock("./files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./files")>()),
  extractDocument: vi.fn(),
  pickDocumentFile: vi.fn(),
  pickSongFiles: vi.fn(),
  readTextFile: vi.fn(),
  saveExportDocx: vi.fn(),
}));

const FORBIDDEN = ["Harbor", "Light"].join(" ");
const byId = (id: string) => screen.getByTestId(id);
const click = (id: string) => fireEvent.click(byId(id));
let nextId = 0;

beforeEach(() => {
  nextId = 0;
  vi.mocked(listSongs).mockResolvedValue([]);
  vi.mocked(getSong).mockImplementation((id) =>
    Promise.reject(new Error(`no song ${id}`)),
  );
  vi.mocked(saveSong).mockReset();
  vi.mocked(saveSong).mockImplementation((chordpro, id) =>
    Promise.resolve({
      id: id ?? `new${++nextId}`,
      chordpro,
      createdAt: "",
      updatedAt: "",
    } as unknown as Song),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

async function reviewReply(reply: string): Promise<void> {
  render(<App />);
  await screen.findByTestId("ai-import");
  click("ai-import");
  fireEvent.change(byId("ai-reply"), { target: { value: reply } });
  click("ai-parse");
  click("ai-review");
  await screen.findByTestId("editor");
}

const bdis = (): string[] =>
  [...byId("reviewing-file").querySelectorAll("bdi")].map(
    (b) => b.textContent ?? "",
  );

describe("review labels from an AI reply", () => {
  it("isolates the source and the fixture's song titles in two bdi each", async () => {
    const reply = readAiReply("two_songs_fenced");
    const { songs } = parseAiReply(reply);
    expect(songs).toHaveLength(2);
    const titles = songs.map((s) => s.title);
    expect(titles.every((t) => typeof t === "string" && t !== "")).toBe(true);
    expect(titles[1]).not.toContain(FORBIDDEN);

    await reviewReply(reply);
    expect(bdis()).toEqual([STRINGS.aiDefaultSource, titles[0]]);
    // Skip the first song to review the second.
    click("editor-cancel");
    click("confirm-discard-yes");
    await waitFor(() => expect(bdis()[1]).toBe(titles[1]));
    expect(bdis()).toEqual([STRINGS.aiDefaultSource, titles[1]]);
    expect(saveSong).not.toHaveBeenCalled();
  });

  it("keeps a title with a slash whole in the second bdi", async () => {
    await reviewReply("```chordpro\n{title: Left/Right}\n[C]one [G]two\n```");
    expect(bdis()).toEqual([STRINGS.aiDefaultSource, "Left/Right"]);
  });
});
