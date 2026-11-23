import type { Page } from "@playwright/test";

/** A fixed in-memory library: one song with a key, one without. */
export const KEYED = { id: "keyed", title: "Keyed Song", key: "G" } as const;
export const KEYLESS = {
  id: "keyless",
  title: "Keyless Song",
  key: null,
} as const;

/** Original songs for the export specs: Hebrew with niqqud, and a dense-chord line. */
export const HEBREW = { id: "hebrew", title: "שיר הבוקר" } as const;
export const DENSE = { id: "dense", title: "Dense Chords" } as const;

function install(): void {
  const stamp = "2026-01-01T00:00:00Z";
  const songs: Record<string, Record<string, unknown>> = {
    keyed: {
      id: "keyed",
      title: "Keyed Song",
      artist: null,
      key: "G",
      capo: null,
      language: "en",
      createdAt: stamp,
      updatedAt: stamp,
      chordpro:
        "{title: Keyed Song}\n{key: G}\n[G]First lyric line\n[D]Second lyric line\n",
    },
    keyless: {
      id: "keyless",
      title: "Keyless Song",
      artist: null,
      key: null,
      capo: null,
      language: "en",
      createdAt: stamp,
      updatedAt: stamp,
      chordpro: "{title: Keyless Song}\n[Am]Third lyric line\n",
    },
    hebrew: {
      id: "hebrew",
      title: "שיר הבוקר",
      artist: null,
      key: "Am",
      capo: null,
      language: "he",
      createdAt: stamp,
      updatedAt: stamp,
      chordpro:
        "{title: שיר הבוקר}\n{meta: direction rtl}\n{key: Am}\n\n[Am]אור על [G]ההר [F]הרָחוֹק\n[Dm]צִפּוֹר [E7]קטנה [Am]שָׁרָה\n",
    },
    dense: {
      id: "dense",
      title: "Dense Chords",
      artist: null,
      key: "C",
      capo: null,
      language: "he",
      createdAt: stamp,
      updatedAt: stamp,
      // RTL like packages/test-fixtures/fixtures/dense_chords.cho (body lines 5-7).
      chordpro:
        "{title: Dense Chords}\n{meta: direction rtl}\n{key: C}\n\n[Am7/G]ש[Cmaj7]מ[Dsus4]י[F#m7]ם [Am7/G]א[Cmaj7]ו[Dsus4]ר [F#m7]ע[Am7/G]ל\n\n[Am]ושוב חוזר השיר\n",
    },
  };
  type Item = Record<string, unknown>;
  interface StubSetlist {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    items: Item[];
  }
  const setlists = new Map<string, StubSetlist>();
  let nextId = 1;
  const newId = (prefix: string) => `${prefix}${nextId++}`;
  const setlistOf = (id: unknown): StubSetlist => {
    const found = setlists.get(String(id));
    if (found === undefined) {
      throw { kind: "NotFound", message: `setlist ${String(id)} not found` };
    }
    return found;
  };
  const numbered = (list: StubSetlist): StubSetlist => {
    list.items.forEach((item, i) => {
      item.position = i;
    });
    return list;
  };
  const itemFor = (songId: string): Item => {
    const song = songs[songId];
    if (song === undefined) {
      throw { kind: "NotFound", message: `song ${songId} not found` };
    }
    return {
      id: newId("item"),
      songId,
      position: 0,
      transpose: 0,
      capo: null,
      title: song.title,
      artist: song.artist,
      key: song.key,
      songCapo: song.capo,
      language: song.language,
    };
  };
  const setlistSummary = (l: StubSetlist) => ({
    id: l.id,
    name: l.name,
    itemCount: l.items.length,
    updatedAt: l.updatedAt,
  });
  const makeSetlist = (name: string): StubSetlist => {
    const list: StubSetlist = {
      id: newId("setlist"),
      name,
      createdAt: stamp,
      updatedAt: stamp,
      items: [],
    };
    setlists.set(list.id, list);
    return list;
  };
  const summary = (s: Record<string, unknown>) => ({
    id: s.id,
    title: s.title,
    artist: s.artist,
    key: s.key,
    language: s.language,
    updatedAt: s.updatedAt,
  });
  const w = window as unknown as Record<string, unknown>;
  w.isTauri = true;
  w.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main", windowLabel: "main" },
    },
    transformCallback: () => 1,
    unregisterCallback: () => {},
    // Covers the dialog plugin's `plugin:dialog|*` commands too: they resolve null (cancel).
    // Results are cloned like real IPC (fresh deserialized objects, no shared references).
    invoke: async (cmd: string, args: Record<string, unknown> | undefined) =>
      structuredClone(await handle(cmd, args)),
  };
  async function handle(
    cmd: string,
    args: Record<string, unknown> | undefined,
  ): Promise<unknown> {
    switch (cmd) {
      case "list_songs":
        return Object.values(songs).map(summary);
      case "get_song":
        return songs[String(args?.id)];
      case "search_songs":
        return [];
      case "save_song": {
        const input = args?.input as { id?: string | null; chordpro: string };
        const song = songs[input.id ?? "keyed"]!;
        song.chordpro = input.chordpro;
        return song;
      }
      case "list_setlists":
        return [...setlists.values()].map(setlistSummary);
      case "get_setlist":
        return setlistOf(args?.id);
      case "create_setlist":
        return makeSetlist(String(args?.name));
      case "rename_setlist": {
        const list = setlistOf(args?.id);
        list.name = String(args?.name);
        return list;
      }
      case "delete_setlist":
        setlists.delete(String(setlistOf(args?.id).id));
        return null;
      case "duplicate_setlist": {
        const from = setlistOf(args?.id);
        const copy = makeSetlist(String(args?.name));
        copy.items = from.items.map((item) => ({
          ...item,
          id: newId("item"),
        }));
        return numbered(copy);
      }
      case "add_setlist_items": {
        const list = setlistOf(args?.setlistId);
        for (const id of args?.songIds as string[]) {
          list.items.push(itemFor(id));
        }
        return numbered(list);
      }
      case "remove_setlist_item": {
        const list = setlistOf(args?.setlistId);
        list.items = list.items.filter((i) => i.id !== args?.itemId);
        return numbered(list);
      }
      case "reorder_setlist_items": {
        const list = setlistOf(args?.setlistId);
        list.items = (args?.itemIds as string[]).map((id) =>
          list.items.find((i) => i.id === id)!,
        );
        return numbered(list);
      }
      case "update_setlist_item": {
        const list = setlistOf(args?.setlistId);
        const item = list.items.find((i) => i.id === args?.itemId);
        if (item === undefined) {
          throw { kind: "NotFound", message: "item not found" };
        }
        item.transpose = args?.transpose;
        item.capo = args?.capo;
        return list;
      }
      case "save_export_docx":
        w.__savedExport = {
          defaultName: args?.defaultName,
          bytes:
            typeof args?.bytesBase64 === "string"
              ? Array.from(atob(args.bytesBase64), (c) => c.charCodeAt(0))
              : args?.bytes,
        };
        return "/tmp/stub-export.docx";
      default:
        return null;
    }
  }
  // English chrome regardless of the runner's browser language.
  try {
    localStorage.setItem("shir.locale", "en");
  } catch {
    /* storage unavailable: the app falls back to detection */
  }
}

/** Runs the app in DB mode against the in-memory library above. */
export async function openApp(page: Page): Promise<void> {
  await page.addInitScript(install);
  await page.goto("/");
  await page.waitForSelector('[data-testid="song-list"] button');
}

export async function openSong(page: Page, title: string): Promise<void> {
  await page
    .locator('[data-testid="song-list"] button', { hasText: title })
    .first()
    .click();
  await page.waitForSelector('[data-testid="song-title"]');
}
