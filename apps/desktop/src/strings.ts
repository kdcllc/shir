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
  deleteAction: "Delete",
  selectSongs: "Select",
  selectAll: "Select all",
  selectDone: "Done",
  deleteSelected: "Delete selected",
  // prettier-ignore
  deleteConfirmBody: "Deleted songs are permanently removed from the library. This cannot be undone.",
  deleteFailed: "Could not delete the song",
  removeGlyph: "×",
  tabVisual: "Visual",
  tabSource: "Source",
  editorTabs: "Editor view",
  undo: "Undo",
  redo: "Redo",
  transposeSongDown: "Transpose song down",
  transposeSongUp: "Transpose song up",
  metaForm: "Song details",
  metaTitle: "Title",
  metaArtist: "Artist",
  metaTempo: "Tempo",
  visualLabel: "Song lines",
  visualHint: "Type lyrics, then click a letter to add a chord",
  editLyrics: "Edit lyrics",
  lyricsInput: "Lyrics",
  addLineBelow: "Add line below",
  removeLine: "Remove line",
  editGlyph: "✎",
  addGlyph: "+",
  chordsLineInput: "Chords",
  commentInput: "Comment",
  sourceOnly: "Edit in Source",
  addSection: "Add section",
  sectionKind: "Section type",
  sectionLabel: "Section label",
  sectionVerse: "Verse",
  sectionChorus: "Chorus",
  sectionBridge: "Bridge",
  sectionUp: "Move section up",
  sectionDown: "Move section down",
  sectionRemove: "Remove section",
  upGlyph: "↑",
  downGlyph: "↓",
  chordPicker: "Chord",
  chordInput: "Chord name",
  chordSuggestions: "Suggestions",
  chordApply: "Apply",
  chordRemove: "Remove chord",
  chordMoveLeft: "Move chord left",
  chordMoveRight: "Move chord right",
  leftGlyph: "←",
  rightGlyph: "→",
  chordUnknown: "Unrecognized chord",
  chordClose: "Close",
  noLabel: "No label",
  sectionOther: "Other",
  sortLabel: "Sort by",
  sortTitle: "Title",
  sortArtist: "Artist",
  sortUpdated: "Recently updated",
  libraryView: "Library view",
  filterLanguage: "Language",
  filterAll: "All",
  filterHebrew: "Hebrew",
  filterEnglish: "English",
  filterMixed: "Mixed",
  badgeHebrew: "HE",
  badgeEnglish: "EN",
  badgeMixed: "HE+EN",
  noFilterMatches: "No songs in this language",
  uiLanguage: "Interface language",
  localeHebrew: "עברית",
  localeEnglish: "English",
  localeHebrewShort: "עב",
  localeEnglishShort: "EN",
  chordAddEmpty: "Add chord",
  fileFilterSongs: "Song files",
} as const;

/** i18next templates replacing the helpers below (`{{var}}` interpolation, `_one` / `_other` plurals). */
export const TEMPLATES = {
  diagnosticsCount_one: "{{count}} problem",
  diagnosticsCount_other: "{{count}} problems",
  importSummary_one: "Imported {{saved}} of {{count}} file",
  importSummary_other: "Imported {{saved}} of {{count}} files",
  importQueued_one: "{{count}} file needs alignment review",
  importQueued_other: "{{count}} files need alignment review",
  deleteSongNamed: "Delete \u2068{{title}}\u2069",
  selectSongNamed: "Select \u2068{{title}}\u2069",
  deleteConfirmTitle: "Delete \u2068{{title}}\u2069?",
  deleteManyTitle: "Delete {{count}} songs?",
  selectedCount: "{{count}} selected",
  deletedCount_one: "Deleted {{count}} song",
  deletedCount_other: "Deleted {{count}} songs",
  deleteManyFailed_one: "Could not delete {{failed}} of {{count}} songs",
  deleteManyFailed_other: "Could not delete {{failed}} of {{count}} songs",
  lineLabel: "Line {{n}}",
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

/** Delete button label for one song: `Delete <title>` (title bidi-isolated). */
export function deleteSongNamed(title: string): string {
  return `Delete \u2068${title}\u2069`;
}

/** Select checkbox label for one song: `Select <title>` (title bidi-isolated). */
export function selectSongNamed(title: string): string {
  return `Select \u2068${title}\u2069`;
}

/** Delete confirmation title for one song: `Delete <title>?` (title bidi-isolated). */
export function deleteConfirmTitle(title: string): string {
  return `Delete \u2068${title}\u2069?`;
}

/** Delete confirmation title for several songs: `Delete 3 songs?`. */
export function deleteManyTitle(n: number): string {
  return `Delete ${n} songs?`;
}

/** Select-mode count: `3 selected`. */
export function selectedCount(n: number): string {
  return `${n} selected`;
}

/** Delete status: `Deleted 1 song`, otherwise `Deleted N songs`. */
export function deletedCount(n: number): string {
  return n === 1 ? "Deleted 1 song" : `Deleted ${n} songs`;
}

/** Partial delete failure: `Could not delete 2 of 5 songs`. */
export function deleteManyFailed(failed: number, total: number): string {
  return `Could not delete ${failed} of ${total} songs`;
}

/** Accessible name of a visual editor line: `Line 4`. */
export function lineLabel(n: number): string {
  return `Line ${n}`;
}
