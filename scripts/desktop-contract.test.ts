// Desktop viewer contract: docs/DESKTOP.md stays in step with strings.ts and the emitted test ids.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const read = (rel: string): string =>
  readFileSync(path.join(repoRoot, rel), "utf8");

interface Source {
  file: string;
  text: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const desktopSources: Source[] = walk(path.join(repoRoot, "apps/desktop/src"))
  .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
  .map((abs) => ({
    file: path.relative(repoRoot, abs).split(path.sep).join("/"),
    text: readFileSync(abs, "utf8"),
  }));

/** Rows of the markdown table under `## <heading>`, as cell arrays (header + separator dropped). */
function tableRows(markdown: string, heading: string): string[][] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start < 0) return [];
  const rows: string[][] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^## /.test(line)) break;
    const t = line.trim();
    if (!t.startsWith("|")) continue;
    rows.push(
      t
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((c) => c.trim()),
    );
  }
  return rows.slice(2);
}

const stripTicks = (s: string): string => s.replace(/^`|`$/g, "");

// ---- (a) test ids, bidirectional ------------------------------------------

function emittedIds(sources: Source[]): Set<string> {
  const ids = new Set<string>();
  for (const { text } of sources)
    for (const m of text.matchAll(/data-testid="([^"]+)"/g)) ids.add(m[1]!);
  return ids;
}

function checkTestIds(sources: Source[], docIds: string[]): string[] {
  const emitted = emittedIds(sources);
  const problems: string[] = [];
  for (const id of emitted)
    if (!docIds.includes(id)) problems.push(`undocumented test id: ${id}`);
  for (const id of docIds)
    if (!emitted.has(id)) problems.push(`documented but never emitted: ${id}`);
  return problems;
}

const docs = read("docs/DESKTOP.md");
const docTestIds = tableRows(docs, "Test ids").map((r) => stripTicks(r[0]!));

describe("(a) docs/DESKTOP.md test ids", () => {
  it("parses a non-trivial table and source set", () => {
    expect(docTestIds.length).toBeGreaterThanOrEqual(16);
    expect(desktopSources.length).toBeGreaterThanOrEqual(6);
    expect(emittedIds(desktopSources).has("song-item")).toBe(true);
  });

  it("every emitted id is documented and every documented id is emitted", () => {
    expect(checkTestIds(desktopSources, docTestIds)).toEqual([]);
  });
});

// ---- (b) strings ----------------------------------------------------------

function parseStrings(source: string): Record<string, string> {
  const block = /export const STRINGS = \{([\s\S]*?)\} as const/.exec(source);
  const out: Record<string, string> = {};
  for (const m of (block?.[1] ?? "").matchAll(/(\w+):\s*"([^"]*)"/g))
    out[m[1]!] = m[2]!;
  return out;
}

describe("(b) docs/DESKTOP.md strings", () => {
  const strings = parseStrings(read("apps/desktop/src/strings.ts"));
  const rows = tableRows(docs, "Strings");
  const documented = Object.fromEntries(
    rows.map((r) => [stripTicks(r[0]!), stripTicks(r[1]!)]),
  );

  it("parsed STRINGS keys match an independent line count", () => {
    const source = read("apps/desktop/src/strings.ts");
    const literal = /export const STRINGS = \{([\s\S]*?)\} as const/.exec(
      source,
    )?.[1];
    const lineCount = (literal ?? "")
      .split(/\r?\n/)
      .filter((l) => /^\s+\w+: "/.test(l)).length;
    expect(lineCount).toBeGreaterThan(0);
    expect(Object.keys(strings)).toHaveLength(lineCount);
  });

  it("every STRINGS key is in the table with the same value", () => {
    for (const [key, value] of Object.entries(strings))
      expect(documented[key], key).toBe(value);
  });

  it("the table has no key missing from STRINGS", () => {
    expect(Object.keys(documented).sort()).toEqual(Object.keys(strings).sort());
  });
});

// ---- (c) no hard-coded JSX text -------------------------------------------

const OPEN = "\u0001";
const CLOSE = "\u0002";
const EXPR = "\u0003";

/**
 * Replaces every `{…}` with balanced-brace scanning (nested braces, JSX inside braces). A group
 * without markup collapses to a placeholder (JSX expression, attribute value, code block). A
 * group that contains JSX (`<`) is kept, scanned recursively, between OPEN/CLOSE markers so
 * literal text nested in `cond ? (<p>Hello</p>) : …` is still found.
 */
function stripBraces(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch !== "{") {
      out += ch;
      i += 1;
      continue;
    }
    let depth = 1;
    let j = i + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth += 1;
      else if (text[j] === "}") depth -= 1;
      j += 1;
    }
    if (depth > 0) {
      out += text.slice(i);
      break;
    }
    const inner = text.slice(i + 1, j - 1);
    out += inner.includes("<") ? `${OPEN}${stripBraces(inner)}${CLOSE}` : EXPR;
    i = j;
  }
  return out;
}

/** The part of a `>…<` run that sits outside any kept brace group (its JSX text). */
function outsideBraces(run: string): string {
  const firstOpen = run.indexOf(OPEN);
  const firstClose = run.indexOf(CLOSE);
  // A run that starts inside a kept group meets its CLOSE before any OPEN.
  let depth =
    firstClose >= 0 && (firstOpen < 0 || firstClose < firstOpen) ? 1 : 0;
  let text = "";
  for (const ch of run) {
    if (ch === OPEN) depth += 1;
    else if (ch === CLOSE) depth = Math.max(0, depth - 1);
    else if (depth === 0) text += ch;
  }
  return text;
}

/** Files whose JSX text (between `>` and `<`, outside `{…}`) holds 3+ Latin letters. */
function checkJsxText(sources: Source[]): string[] {
  const problems: string[] = [];
  for (const { file, text } of sources) {
    const code = stripBraces(text);
    for (const m of code.matchAll(/(?<![=?])>([^<>]*)</g)) {
      // Ignore HTML entities and the `return (` / `) : (` residue of JSX control flow.
      const jsxText = outsideBraces(m[1]!);
      const visible = jsxText
        .replace(/&#?\w+;/g, "")
        .replace(/\breturn\b/g, "");
      if (/[A-Za-z]{3}/.test(visible))
        problems.push(`${file}: ${JSON.stringify(jsxText.trim())}`);
    }
  }
  return problems;
}

describe("(c) no hard-coded JSX text", () => {
  it("finds no Latin JSX text outside {…}", () => {
    expect(checkJsxText(desktopSources)).toEqual([]);
  });
});

// ---- (d) self-tests -------------------------------------------------------

describe("(d) self-tests", () => {
  it("(a) fires on an injected undocumented id and on a never-emitted documented id", () => {
    const injected = [
      ...desktopSources,
      { file: "x.tsx", text: '<i data-testid="secret-id" />' },
    ];
    expect(checkTestIds(injected, docTestIds)).toEqual([
      "undocumented test id: secret-id",
    ]);
    expect(checkTestIds(desktopSources, [...docTestIds, "ghost"])).toEqual([
      "documented but never emitted: ghost",
    ]);
  });

  it("(c) fires on <p>Hello</p> and accepts expression-only children", () => {
    expect(checkJsxText([{ file: "x.tsx", text: "<p>Hello</p>" }])).toEqual([
      'x.tsx: "Hello"',
    ]);
    expect(
      checkJsxText([{ file: "m.tsx", text: "<p>\n  {a} Hello\n</p>" }]),
    ).toHaveLength(1);
    expect(
      checkJsxText([{ file: "y.tsx", text: "<p>{STRINGS.capo}</p>" }]),
    ).toEqual([]);
    expect(checkJsxText([{ file: "z.tsx", text: "<p>{a} · {b}</p>" }])).toEqual(
      [],
    );
    expect(
      checkJsxText([{ file: "t.tsx", text: "{ok ? (<p>Hello</p>) : null}" }]),
    ).toEqual(['t.tsx: "Hello"']);
    expect(
      checkJsxText([
        { file: "j.tsx", text: "<p>{cond ? <b>x</b> : null} Hello</p>" },
      ]),
    ).toEqual(['j.tsx: "Hello"']);
  });

  it("(b) parser reads values and the table parser drops header rows", () => {
    expect(
      parseStrings('export const STRINGS = { a: "x y" } as const;'),
    ).toEqual({ a: "x y" });
    expect(
      tableRows("## T\n\n| A | B |\n| - | - |\n| `k` | `v` |\n", "T"),
    ).toEqual([["`k`", "`v`"]]);
  });
});
