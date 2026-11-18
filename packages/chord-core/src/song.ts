import type { TextDirection } from "./direction";
import { splitGraphemes } from "./graphemes";
import {
  META_NAMES,
  type ChordAnchor,
  type Diagnostic,
  type DiagnosticCode,
  type ParseResult,
  type SongLine,
  type SongModel,
} from "./model";

/** Tag grammar from `docs/CHORDPRO.md` `## Lines`, matched on the trimmed line. */
const TAG_RE = /^\{\s*([A-Za-z_][A-Za-z0-9_-]*)\s*(?::\s*([^}]*?))?\s*\}$/;
const SECTION_TAG_RE = /^(start|end)_of_([a-z0-9_]+)$/;
const LABEL_ATTR_RE = /^label="([^"]*)"$/;

const SECTION_ALIASES: Readonly<
  Record<string, { edge: "start" | "end"; section: string }>
> = {
  soc: { edge: "start", section: "chorus" },
  eoc: { edge: "end", section: "chorus" },
  sov: { edge: "start", section: "verse" },
  eov: { edge: "end", section: "verse" },
  sob: { edge: "start", section: "bridge" },
  eob: { edge: "end", section: "bridge" },
  sot: { edge: "start", section: "tab" },
  eot: { edge: "end", section: "tab" },
  sog: { edge: "start", section: "grid" },
  eog: { edge: "end", section: "grid" },
};

export const LITERAL_SECTIONS: ReadonlySet<string> = new Set([
  "tab",
  "grid",
  "abc",
  "ly",
  "textblock",
  "svg",
]);

const META_NAME_SET: ReadonlySet<string> = new Set(META_NAMES);

const COMMENT_STYLES: Readonly<Record<string, "normal" | "italic" | "box">> = {
  comment: "normal",
  c: "normal",
  comment_italic: "italic",
  ci: "italic",
  comment_box: "box",
  cb: "box",
};

interface Tag {
  name: string;
  value: string | undefined;
}

/** Match the tag grammar on a trimmed line; an empty value counts as none. */
function matchTag(trimmed: string): Tag | null {
  const m = TAG_RE.exec(trimmed);
  if (!m) return null;
  const value = (m[2] ?? "").trim();
  return {
    name: (m[1] ?? "").toLowerCase(),
    value: value === "" ? undefined : value,
  };
}

/** The section edge and canonical name of a section tag, or null. */
function sectionOf(
  name: string,
): { edge: "start" | "end"; section: string } | null {
  const alias = Object.hasOwn(SECTION_ALIASES, name)
    ? SECTION_ALIASES[name]
    : undefined;
  if (alias) return alias;
  const m = SECTION_TAG_RE.exec(name);
  if (!m) return null;
  return { edge: m[1] === "start" ? "start" : "end", section: m[2] ?? "" };
}

type TagLine = Exclude<
  SongLine,
  { kind: "lyric" | "chords" | "empty" | "tab" | "remark" | "raw" }
>;

/** Map a well-formed tag to its line (spec `## Tags`). */
function tagToLine(tag: Tag): TagLine {
  const { name, value } = tag;
  if (name === "meta") {
    if (value === undefined) return { kind: "directive", name };
    const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(value);
    const inner = (m?.[1] ?? value).toLowerCase();
    return { kind: "meta", name: inner, value: (m?.[2] ?? "").trim() };
  }
  if (META_NAME_SET.has(name)) {
    return { kind: "meta", name, value: value ?? "" };
  }
  if (name === "t") return { kind: "meta", name: "title", value: value ?? "" };
  if (name === "st") {
    return { kind: "meta", name: "subtitle", value: value ?? "" };
  }
  const style = Object.hasOwn(COMMENT_STYLES, name)
    ? COMMENT_STYLES[name]
    : undefined;
  if (style) return { kind: "comment", style, text: value ?? "" };
  const section = sectionOf(name);
  if (section) {
    if (section.edge === "end") {
      return { kind: "section", edge: "end", section: section.section };
    }
    const label =
      value === undefined
        ? undefined
        : (LABEL_ATTR_RE.exec(value)?.[1] ?? value);
    return {
      kind: "section",
      edge: "start",
      section: section.section,
      ...(label !== undefined && label !== "" ? { label } : {}),
    };
  }
  return value === undefined
    ? { kind: "directive", name }
    : { kind: "directive", name, value };
}

interface OpenSection {
  section: string;
  line: number;
  column: number;
  literal: boolean;
}

/**
 * Parse a lyric-path line. Returns the line, or a syntax error with the
 * 0-based offset of the first error from left to right.
 */
function parseLyricLine(
  text: string,
): { line: SongLine } | { error: string; offset: number } {
  let lyric = "";
  const chords: ChordAnchor[] = [];
  let pos = 0;
  while (pos < text.length) {
    const open = text.indexOf("[", pos);
    if (open === -1) {
      lyric += text.slice(pos);
      break;
    }
    lyric += text.slice(pos, open);
    let i = open + 1;
    while (i < text.length && text[i] !== "[" && text[i] !== "]") i++;
    if (i >= text.length) {
      return { error: "Unterminated chord", offset: open };
    }
    if (text[i] === "[") {
      return { error: "Nested chord bracket", offset: i };
    }
    const chord = text.slice(open + 1, i);
    if (chord === "") return { error: "Empty chord", offset: open };
    chords.push({ index: splitGraphemes(lyric).length, chord });
    pos = i + 1;
  }
  if (lyric.trim() === "" && chords.length > 0) {
    return { line: { kind: "chords", chords: chords.map((c) => c.chord) } };
  }
  return { line: { kind: "lyric", lyric, chords } };
}

function toDirection(value: string): TextDirection | undefined {
  const v = value.trim().toLowerCase();
  return v === "rtl" || v === "ltr" ? v : undefined;
}

/**
 * Parse ChordPro source into the line model (`docs/CHORDPRO.md`). One
 * `SongLine` per source line; never throws; problems become diagnostics.
 */
export function parseSong(source: string): ParseResult {
  const parts = source.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  const lastIndex = source.endsWith("\n") ? -1 : parts.length - 1;

  const lines: SongLine[] = [];
  const diagnostics: Diagnostic[] = [];
  const diag = (
    line: number,
    column: number,
    code: DiagnosticCode,
    message: string,
  ): void => {
    diagnostics.push({ line, column, code, message });
  };

  let open: OpenSection | null = null;
  let capoSeen = false;
  let capo: number | undefined;

  parts.forEach((part, idx) => {
    const lineNo = idx + 1;
    // Every `\r` directly before a `\n` is stripped; the last element of a
    // source without a final newline has no `\n` after it.
    const text = idx === lastIndex ? part : part.replace(/\r+$/, "");
    const trimmed = text.trim();
    const braceColumn = text.indexOf("{") + 1;

    const closeSection = (section: string): void => {
      if (open === null) {
        diag(
          lineNo,
          braceColumn,
          "section-unopened",
          `end_of_${section} without an open section`,
        );
      } else if (open.section !== section) {
        diag(
          lineNo,
          braceColumn,
          "section-mismatch",
          `end_of_${section} while ${open.section} is open`,
        );
      }
      open = null;
    };

    // 1. Inside an open literal section.
    if (open !== null && (open as OpenSection).literal) {
      const tag = trimmed.startsWith("{") ? matchTag(trimmed) : null;
      const sec = tag ? sectionOf(tag.name) : null;
      if (
        sec &&
        sec.edge === "end" &&
        sec.section === (open as OpenSection).section
      ) {
        closeSection(sec.section);
        lines.push({ kind: "section", edge: "end", section: sec.section });
      } else {
        lines.push({ kind: "tab", text });
      }
      return;
    }

    // 2. Remark.
    if (text.startsWith("#")) {
      lines.push({ kind: "remark", text: text.slice(1) });
      return;
    }

    // 3. Tag line.
    if (trimmed.startsWith("{")) {
      const tag = matchTag(trimmed);
      if (!tag) {
        diag(lineNo, braceColumn, "syntax", "Malformed directive");
        lines.push({ kind: "raw", text });
        return;
      }
      const line = tagToLine(tag);
      if (line.kind === "section") {
        if (line.edge === "end") {
          closeSection(line.section);
        } else {
          const prev = open as OpenSection | null;
          if (prev !== null) {
            diag(
              prev.line,
              prev.column,
              "section-unclosed",
              `${prev.section} section is not closed`,
            );
          }
          open = {
            section: line.section,
            line: lineNo,
            column: braceColumn,
            literal: LITERAL_SECTIONS.has(line.section),
          };
        }
      } else if (line.kind === "meta" && line.name === "capo" && !capoSeen) {
        capoSeen = true;
        if (/^\d+$/.test(line.value) && Number(line.value) <= 24) {
          capo = Number(line.value);
        } else {
          diag(
            lineNo,
            braceColumn,
            "invalid-capo",
            `Invalid capo value "${line.value}"`,
          );
        }
      }
      lines.push(line);
      return;
    }

    // 4. Empty.
    if (trimmed === "" && !text.includes("[")) {
      lines.push({ kind: "empty" });
      return;
    }

    // 5. Lyric path.
    const result = parseLyricLine(text);
    if ("error" in result) {
      diag(lineNo, result.offset + 1, "syntax", result.error);
      lines.push({ kind: "raw", text });
    } else {
      lines.push(result.line);
    }
  });

  const finalOpen = open as OpenSection | null;
  if (finalOpen !== null) {
    diag(
      finalOpen.line,
      finalOpen.column,
      "section-unclosed",
      `${finalOpen.section} section is not closed`,
    );
  }

  const metaValue = (name: string): string | undefined => {
    for (const l of lines) {
      if (l.kind === "meta" && l.name === name) return l.value;
    }
    return undefined;
  };
  const title = metaValue("title");
  const key = metaValue("key");

  const directions = lines.flatMap((l) =>
    l.kind === "meta" && l.name === "direction" ? [toDirection(l.value)] : [],
  );
  const first = directions[0];
  const direction =
    first !== undefined && directions.every((d) => d === first)
      ? first
      : undefined;

  const song: SongModel = {
    ...(title !== undefined && title !== "" ? { title } : {}),
    ...(direction !== undefined ? { direction } : {}),
    ...(key !== undefined && key !== "" ? { key } : {}),
    ...(capo !== undefined ? { capo } : {}),
    lines,
  };

  diagnostics.sort((a, b) => a.line - b.line || a.column - b.column);
  return { song, diagnostics };
}
