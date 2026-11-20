import {
  buildExportDocument,
  parseSong,
  type ExportDocument,
  type ExportEntry,
} from "chord-core";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ExportLabels, ExportMeta } from "./types";

export const LABELS: ExportLabels = {
  setlist: "SL",
  key: "KEY",
  capo: "CAPO",
  transpose: "TR",
  songs: "SONGS",
  date: "DATE",
};

export const META: ExportMeta = {
  lang: "he",
  dir: "rtl",
  dateText: "2026-11-20",
};

export function fixtureSource(name: string): string {
  return readFileSync(
    path.resolve(
      import.meta.dirname,
      "../../../../packages/test-fixtures/fixtures",
      `${name}.cho`,
    ),
    "utf8",
  );
}

export function entry(
  name: string,
  extra: Partial<Omit<ExportEntry, "song">> = {},
): ExportEntry {
  return { song: parseSong(fixtureSource(name)).song, ...extra };
}

export function inlineEntry(source: string): ExportEntry {
  return { song: parseSong(source).song };
}

export type ExportDocumentLike = ExportDocument;

export function docOf(title: string, entries: ExportEntry[]): ExportDocument {
  return buildExportDocument(title, entries);
}
