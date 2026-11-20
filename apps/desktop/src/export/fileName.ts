import { splitGraphemes } from "chord-core";

const MAX_GRAPHEMES = 100;
const FORBIDDEN = /[/\\:*?"<>|\p{Cc}]/gu;

/** A safe file name for an export: forbidden characters become `-`, capped at 100 graphemes. */
export function exportFileName(title: string, ext: "docx" | "pdf"): string {
  // Whitespace (including tab and newline) collapses first; remaining control characters become "-".
  const cleaned = title.replace(/\s+/gu, " ").replace(FORBIDDEN, "-").trim();
  const capped = splitGraphemes(cleaned)
    .slice(0, MAX_GRAPHEMES)
    .join("")
    .trim();
  return `${capped === "" ? "setlist" : capped}.${ext}`;
}
