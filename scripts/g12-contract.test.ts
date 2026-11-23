// G12 cross-task contract: the base64 payload literal shared by the TS and Rust tests, the
// bytesBase64 IPC shape, and the retired songbook title absent from text fixtures and chord-core.
// Each check is a pure function over file text with an in-memory negative self-test.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const read = (rel: string): string =>
  readFileSync(path.join(repoRoot, rel), "utf8");

const TS_TEST = "apps/desktop/src/g12.exportPayload.test.ts";
const RS_TEST = "apps/desktop/src-tauri/tests/g12_integration.rs";
const BINDINGS = "apps/desktop/src/bindings.ts";
const FILES_TS = "apps/desktop/src/files.ts";
const SCAN_DIRS = [
  "packages/test-fixtures/doc",
  "packages/test-fixtures/ai",
  "packages/chord-core/src",
] as const;
const BINARY_EXTENSIONS = new Set([".docx", ".odt", ".pdf"]);
/** Built at runtime so this file does not contain the retired title. */
const RETIRED_TITLE = ["Harbor", "Light"].join(" ");

// ---- (a) the base64 literal ------------------------------------------------------------

const EXPECTED_BASE64 = Buffer.from([...Array(256).keys()]).toString("base64");

function literalOf(src: string): string | null {
  const m = /BYTES_0_255_BASE64\s*(?::\s*&str\s*)?=\s*"([A-Za-z0-9+/=]+)"/.exec(
    src,
  );
  return m === null ? null : (m[1] as string);
}

function literalProblems(ts: string, rs: string): string[] {
  const a = literalOf(ts);
  const b = literalOf(rs);
  const problems: string[] = [];
  if (a === null) problems.push("TS test has no BYTES_0_255_BASE64 literal");
  if (b === null) problems.push("Rust test has no BYTES_0_255_BASE64 literal");
  if (a !== null && b !== null && a !== b) {
    problems.push("the TS and Rust BYTES_0_255_BASE64 literals differ");
  }
  if (a !== null && a !== EXPECTED_BASE64) {
    problems.push("the TS literal is not the base64 of bytes 0..=255");
  }
  if (b !== null && b !== EXPECTED_BASE64) {
    problems.push("the Rust literal is not the base64 of bytes 0..=255");
  }
  return problems;
}

// ---- (b) the IPC shape -----------------------------------------------------------------

function ipcProblems(bindings: string, filesTs: string): string[] {
  const problems: string[] = [];
  const line = bindings.split("\n").find((l) => /\bsaveExportDocx\s*:/.test(l));
  if (line === undefined) {
    problems.push("bindings.ts has no saveExportDocx");
  } else if (!/\bbytesBase64\s*:\s*string\b/.test(line)) {
    problems.push("saveExportDocx does not take bytesBase64: string");
  }
  if (/Array\.from\(\s*bytes\s*\)/.test(filesTs)) {
    problems.push("files.ts still sends Array.from(bytes)");
  }
  return problems;
}

// ---- (c) the retired title ---------------------------------------------------------------

function titleProblems(file: string, text: string): string[] {
  return text.includes(RETIRED_TITLE)
    ? [`${file} contains the retired songbook title`]
    : [];
}

function textFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(repoRoot, dir))) {
    if (name === "node_modules") continue;
    const rel = `${dir}/${name}`;
    const stat = statSync(path.join(repoRoot, rel));
    if (stat.isDirectory()) out.push(...textFiles(rel));
    else if (!BINARY_EXTENSIONS.has(path.extname(name).toLowerCase())) {
      out.push(rel);
    }
  }
  return out;
}

describe("g12 contract (a): the base64 literal", () => {
  it("is identical in the TS and Rust tests and is the base64 of bytes 0..=255", () => {
    expect(EXPECTED_BASE64).toHaveLength(344);
    expect(literalProblems(read(TS_TEST), read(RS_TEST))).toEqual([]);
  });

  it("negative: one changed character in either copy is flagged", () => {
    const ts = read(TS_TEST);
    const rs = read(RS_TEST);
    const lit = literalOf(ts) as string;
    const flip = lit.replace(/^AAEC/, "AAED");
    expect(flip).not.toBe(lit);
    expect(literalProblems(ts.replace(lit, flip), rs).length).toBeGreaterThan(
      0,
    );
    expect(literalProblems(ts, rs.replace(lit, flip)).length).toBeGreaterThan(
      0,
    );
  });
});

describe("g12 contract (b): bytesBase64 over IPC", () => {
  it("saveExportDocx takes bytesBase64: string and files.ts does not spread the bytes into an array", () => {
    expect(ipcProblems(read(BINDINGS), read(FILES_TS))).toEqual([]);
  });

  it("negative: a number[] parameter or Array.from(bytes) is flagged", () => {
    const bindings = read(BINDINGS);
    const filesTs = read(FILES_TS);
    const mutated = bindings.replace("bytesBase64: string", "bytes: number[]");
    expect(mutated).not.toBe(bindings);
    expect(ipcProblems(mutated, filesTs)).toEqual([
      "saveExportDocx does not take bytesBase64: string",
    ]);
    expect(
      ipcProblems(bindings, `${filesTs}\nconst x = Array.from(bytes);`),
    ).toEqual(["files.ts still sends Array.from(bytes)"]);
  });
});

describe("g12 contract (c): the retired songbook title", () => {
  it("occurs in no text file of the document fixtures, AI fixtures or chord-core", () => {
    const files = SCAN_DIRS.flatMap(textFiles);
    // Precondition: the scan really reaches the fixtures and chord-core sources.
    expect(files).toContain("packages/test-fixtures/doc/songbook_mixed.rtf");
    expect(files).toContain("packages/test-fixtures/ai/two_songs_fenced.txt");
    expect(files).toContain("packages/chord-core/src/aiReply.ts");
    expect(files.some((f) => f.endsWith(".docx"))).toBe(false);
    expect(files.flatMap((f) => titleProblems(f, read(f)))).toEqual([]);
  });

  it("negative: an injected occurrence is flagged", () => {
    const clean = read("packages/test-fixtures/ai/two_songs_fenced.txt");
    expect(titleProblems("x", clean)).toEqual([]);
    expect(titleProblems("x", `${clean}\n{title: ${RETIRED_TITLE}}\n`)).toEqual(
      ["x contains the retired songbook title"],
    );
  });
});
