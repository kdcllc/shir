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
  searching: "Searching…",
  libraryEmpty: "No songs in the library",
  songLoadFailed: "Could not open this song",
  noKey: "No key",
  separator: "·",
  transposeDownGlyph: "−",
  transposeUpGlyph: "+",
  newSong: "New song",
  editSong: "Edit",
  openFiles: "Open files…",
  editorLabel: "ChordPro text",
  previewLabel: "Preview",
  save: "Save",
  cancel: "Cancel",
  paste: "Paste",
  convert: "Convert",
  flipAlignment: "Flip alignment",
  alreadyChordPro: "Already ChordPro, nothing to convert",
  // prettier-ignore
  pasteFailed: "Could not read the clipboard. Paste with Ctrl+V, then use Convert.",
  importWarnings: "Import warnings",
  saveFailed: "Could not save the song",
  discardTitle: "Discard unsaved changes?",
  discardBody: "Your changes to this song have not been saved.",
  keepEditing: "Keep editing",
  discard: "Discard",
  reviewingFile: "Reviewing file",
  importConverted: "Converted from chords over lyrics",
  importSkipped: "Skipped files",
  importPickFailed: "Could not open files",
  libraryReloadFailed: "Could not refresh the song list",
} as const;

/** Diagnostics heading count: `1 problem`, otherwise `N problems`. */
export function diagnosticsCount(n: number): string {
  return n === 1 ? "1 problem" : `${n} problems`;
}

/** Import summary: `Imported 2 of 3 files`. */
export function importSummary(saved: number, total: number): string {
  return `Imported ${saved} of ${total} ${total === 1 ? "file" : "files"}`;
}

/** Queued files notice: `1 file needs alignment review`, otherwise `N files need alignment review`. */
export function importQueued(n: number): string {
  return n === 1
    ? "1 file needs alignment review"
    : `${n} files need alignment review`;
}
