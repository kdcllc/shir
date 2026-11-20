import type { ExportDocument } from "chord-core";
import { saveExportDocx } from "../files";
import { buildDocx } from "./docx";
import { exportFileName } from "./fileName";
import type { ExportLabels, ExportMeta } from "./types";

/** Builds the Word file and saves it through the backend dialog; errors propagate. */
export async function saveDocx(
  doc: ExportDocument,
  opts: {
    cover: boolean;
    labels: ExportLabels;
    meta: ExportMeta;
    filterName: string;
  },
): Promise<{ status: "saved"; path: string } | { status: "cancelled" }> {
  const bytes = await buildDocx(doc, opts);
  const path = await saveExportDocx(
    exportFileName(doc.title, "docx"),
    opts.filterName,
    bytes,
  );
  return path === null ? { status: "cancelled" } : { status: "saved", path };
}
