/** Cover/header labels, already localized by the caller. */
export interface ExportLabels {
  setlist: string;
  key: string;
  capo: string;
  transpose: string;
  songs: string;
  date: string;
}

/** Document-level metadata supplied by the caller. */
export interface ExportMeta {
  lang: "he" | "en";
  dir: "rtl" | "ltr";
  dateText: string;
}
