import type { Page } from "@playwright/test";

/** A fixed in-memory library: one song with a key, one without. */
export const KEYED = { id: "keyed", title: "Keyed Song", key: "G" } as const;
export const KEYLESS = {
  id: "keyless",
  title: "Keyless Song",
  key: null,
} as const;

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
    invoke: async (cmd: string, args: Record<string, unknown> | undefined) => {
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
        default:
          return null;
      }
    },
  };
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
