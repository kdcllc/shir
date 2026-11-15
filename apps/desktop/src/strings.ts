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
  noKey: "No key",
} as const;

/** Diagnostics heading count: `1 problem`, otherwise `N problems`. */
export function diagnosticsCount(n: number): string {
  return n === 1 ? "1 problem" : `${n} problems`;
}
