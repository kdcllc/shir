/** Every user-visible string of the desktop viewer (see docs/DESKTOP.md). */
export const STRINGS = {
  appName: "Shir",
  appNameHebrew: "שיר",
  groupSamples: "Samples",
  groupTestSongs: "Test songs",
  songList: "Songs",
  transpose: "Transpose",
  transposeDown: "Transpose down",
  transposeUp: "Transpose up",
  capo: "Capo",
  reset: "Reset",
  key: "Key",
  shapes: "Shapes",
  diagnostics: "Diagnostics",
  noSongSelected: "Select a song",
  searchLabel: "Search songs",
  searchPlaceholder: "Search title, artist or lyrics",
  searchResults: "Search results",
  noResults: "No songs match",
  searchFailed: "Search failed",
  // prettier-ignore
  searchUnavailable: "Search unavailable: the song library could not be opened. Showing bundled songs.",
  loadingLibrary: "Loading songs…",
  libraryEmpty: "No songs in the library",
  songLoadFailed: "Could not open this song",
  noKey: "No key",
  separator: "·",
  transposeDownGlyph: "−",
  transposeUpGlyph: "+",
} as const;

/** Diagnostics heading count: `1 problem`, otherwise `N problems`. */
export function diagnosticsCount(n: number): string {
  return n === 1 ? "1 problem" : `${n} problems`;
}
