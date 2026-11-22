// G11 cross-task contract: extract_document registered end to end, no filesystem or save
// permission, the four new crates pinned and documented, the chord-core AI/document modules pure,
// the prompt delimiter, no network code in the AI import UI, and the dialog's test ids documented.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AI_SONG_DELIMITER, buildAiPrompt } from "../packages/chord-core/src";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const read = (rel: string): string =>
  readFileSync(path.join(repoRoot, rel), "utf8");

const BUILD_RS = "apps/desktop/src-tauri/build.rs";
const MOD_RS = "apps/desktop/src-tauri/src/commands/mod.rs";
const CAPABILITY = "apps/desktop/src-tauri/capabilities/default.json";
const BINDINGS = "apps/desktop/src/bindings.ts";
const CARGO_TOML = "apps/desktop/src-tauri/Cargo.toml";
const STACK = "docs/STACK.md";
const DESKTOP_DOC = "docs/DESKTOP.md";
const CORE_INDEX = "packages/chord-core/src/index.ts";
const CORE_FILES = [
  "packages/chord-core/src/documentText.ts",
  "packages/chord-core/src/aiPrompt.ts",
  "packages/chord-core/src/aiReply.ts",
] as const;
const AI_DIALOG = "apps/desktop/src/components/AiImportDialog.tsx";

// ---- (a) command registration ------------------------------------------------------------

function buildRsProblems(src: string): string[] {
  const m = /\.commands\(&\[([\s\S]*?)\]\)/.exec(src);
  if (!m) return ["build.rs has no AppManifest commands list"];
  return (m[1] as string).includes('"extract_document"')
    ? []
    : ["build.rs AppManifest list lacks extract_document"];
}

function collectCommandsProblems(src: string): string[] {
  const m = /collect_commands!\[([\s\S]*?)\]/.exec(src);
  if (!m) return ["collect_commands! not found"];
  const names = (m[1] as string)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map((s) => s.split("::").pop() as string);
  const problems: string[] = [];
  const at = names.indexOf("extract_document");
  if (at < 0) problems.push("collect_commands! lacks extract_document");
  if (names[names.length - 1] !== "log_webview_error") {
    problems.push("collect_commands! does not end with log_webview_error");
  } else if (at >= 0 && at > names.indexOf("log_webview_error")) {
    problems.push("extract_document is after log_webview_error");
  }
  return problems;
}

function permissionsOf(src: string): string[] {
  return (JSON.parse(src) as { permissions: string[] }).permissions;
}

function capabilityAllowProblems(src: string): string[] {
  return permissionsOf(src).includes("allow-extract-document")
    ? []
    : ["capability lacks allow-extract-document"];
}

function bindingsProblems(src: string): string[] {
  return /^\s*extractDocument: \([^\n]*\) => typedError<DocumentText, DocError>\(__TAURI_INVOKE\("extract_document"/m.test(
    src,
  )
    ? []
    : [
        "bindings.ts extractDocument does not return DocumentText with DocError",
      ];
}

describe("(a) extract_document is registered end to end", () => {
  it("is in build.rs, collect_commands! (before the last log_webview_error), the capability and bindings", () => {
    expect(buildRsProblems(read(BUILD_RS))).toEqual([]);
    expect(collectCommandsProblems(read(MOD_RS))).toEqual([]);
    expect(capabilityAllowProblems(read(CAPABILITY))).toEqual([]);
    expect(bindingsProblems(read(BINDINGS))).toEqual([]);
  });

  it("negative: build.rs without the command is reported", () => {
    const src = read(BUILD_RS);
    const mutated = src.replace('"extract_document",', "");
    expect(mutated).not.toBe(src);
    expect(buildRsProblems(mutated)).toEqual([
      "build.rs AppManifest list lacks extract_document",
    ]);
  });

  it("negative: collect_commands! without the command is reported", () => {
    const src = read(MOD_RS);
    const mutated = src.replace(/\s*documents::extract_document,/, "");
    expect(mutated).not.toBe(src);
    expect(collectCommandsProblems(mutated)).toEqual([
      "collect_commands! lacks extract_document",
    ]);
  });

  it("negative: registering it after log_webview_error is reported", () => {
    const src = read(MOD_RS);
    const mutated = src
      .replace(/\s*documents::extract_document,/, "")
      .replace(
        /log_webview_error(\s*\]\))/,
        "log_webview_error,\n            documents::extract_document$1",
      );
    expect(mutated).not.toBe(src);
    expect(collectCommandsProblems(mutated)).toEqual([
      "collect_commands! does not end with log_webview_error",
    ]);
  });

  it("negative: log_webview_error not last with extract_document after it is reported", () => {
    const src = read(MOD_RS);
    const mutated = src.replace(
      "documents::extract_document,",
      "log_webview_error,\n            documents::extract_document,",
    );
    expect(mutated).not.toBe(src);
    expect(
      collectCommandsProblems(
        mutated.replace(/,\s*log_webview_error(\s*\]\))/, "$1"),
      ),
    ).toEqual(["collect_commands! does not end with log_webview_error"]);
  });

  it("negative: a capability without the permission is reported", () => {
    const src = read(CAPABILITY);
    const mutated = src.replace('"allow-extract-document",', "");
    expect(mutated).not.toBe(src);
    expect(capabilityAllowProblems(mutated)).toEqual([
      "capability lacks allow-extract-document",
    ]);
  });

  it("negative: bindings with another result or error type are reported", () => {
    const src = read(BINDINGS);
    const mutated = src.replace(
      "typedError<DocumentText, DocError>",
      "typedError<string, FileError>",
    );
    expect(mutated).not.toBe(src);
    expect(bindingsProblems(mutated)).toEqual([
      "bindings.ts extractDocument does not return DocumentText with DocError",
    ]);
    const renamed = src.replace('"extract_document"', '"other_command"');
    expect(renamed).not.toBe(src);
    expect(bindingsProblems(renamed)).toHaveLength(1);
  });
});

// ---- (b) no filesystem or save permission ------------------------------------------------

function permissionProblems(src: string): string[] {
  const problems: string[] = [];
  for (const p of permissionsOf(src)) {
    if (p.startsWith("fs:")) problems.push(`capability grants ${p}`);
    if (p === "dialog:allow-save") problems.push(`capability grants ${p}`);
  }
  return problems;
}

describe("(b) the capability grants no filesystem or save access", () => {
  it("has no fs:* and no dialog:allow-save", () => {
    expect(permissionProblems(read(CAPABILITY))).toEqual([]);
    expect(permissionsOf(read(CAPABILITY))).toContain("dialog:allow-open");
  });

  it("negative: fs:* and dialog:allow-save are reported", () => {
    const src = read(CAPABILITY);
    const a = src.replace('"dialog:allow-open",', '"fs:allow-read-file",');
    expect(a).not.toBe(src);
    expect(permissionProblems(a)).toEqual([
      "capability grants fs:allow-read-file",
    ]);
    const b = src.replace(
      '"dialog:allow-open",',
      '"dialog:allow-open", "dialog:allow-save",',
    );
    expect(b).not.toBe(src);
    expect(permissionProblems(b)).toEqual([
      "capability grants dialog:allow-save",
    ]);
  });
});

// ---- (c) crates pinned and documented ----------------------------------------------------

const CRATES = ["zip", "quick-xml", "encoding_rs", "pdf-extract"] as const;

/** The version a crate is pinned to in Cargo.toml (`=x.y.z` stripped), or undefined. */
function cargoPin(toml: string, crate: string): string | undefined {
  const esc = crate.replace(/[-]/g, "\\-");
  const re = new RegExp(
    `^${esc}\\s*=\\s*(?:"=?([^"]+)"|\\{[^}]*version\\s*=\\s*"=?([^"]+)")`,
    "m",
  );
  const m = re.exec(toml);
  return m ? (m[1] ?? m[2]) : undefined;
}

function stackProblems(md: string, toml: string): string[] {
  const problems: string[] = [];
  for (const crate of CRATES) {
    const row = new RegExp(
      `^\\|[^|]*\\|\\s*\`${crate}\`\\s*\\|\\s*([^|\\s]+)\\s*\\|\\s*crate\\s*\\|\\s*([^|]*?)\\s*\\|`,
      "m",
    ).exec(md);
    if (!row) {
      problems.push(`STACK.md has no ${crate} row`);
      continue;
    }
    if (row[2] !== "installed (G11)") {
      problems.push(`STACK.md ${crate} is not installed (G11)`);
    }
    const pin = cargoPin(toml, crate);
    if (pin === undefined) problems.push(`Cargo.toml does not pin ${crate}`);
    else if (pin !== row[1]) {
      problems.push(
        `STACK.md ${crate} ${row[1]} differs from Cargo.toml ${pin}`,
      );
    }
  }
  return problems;
}

describe("(c) STACK.md rows match the Cargo.toml pins", () => {
  it("zip, quick-xml, encoding_rs and pdf-extract are installed (G11) at the pinned versions", () => {
    expect(stackProblems(read(STACK), read(CARGO_TOML))).toEqual([]);
    expect(cargoPin(read(CARGO_TOML), "zip")).toBe("9.4.2");
  });

  it("negative: a planned row, a missing row or a version drift is reported", () => {
    const md = read(STACK);
    const toml = read(CARGO_TOML);
    const planned = md.replace(
      /(`quick-xml`[^\n]*?)installed \(G11\)/,
      "$1planned (G11)  ",
    );
    expect(planned).not.toBe(md);
    expect(stackProblems(planned, toml)).toEqual([
      "STACK.md quick-xml is not installed (G11)",
    ]);

    const missing = md.replace(/^[^\n]*`encoding_rs`[^\n]*\n/m, "");
    expect(missing).not.toBe(md);
    expect(stackProblems(missing, toml)).toEqual([
      "STACK.md has no encoding_rs row",
    ]);

    const drift = toml.replace('"=0.12.1"', '"=0.12.2"');
    expect(drift).not.toBe(toml);
    expect(stackProblems(md, drift)).toEqual([
      "STACK.md pdf-extract 0.12.1 differs from Cargo.toml 0.12.2",
    ]);

    const unpinned = toml.replace(/^zip = .*\n/m, "");
    expect(unpinned).not.toBe(toml);
    expect(stackProblems(md, unpinned)).toEqual([
      "Cargo.toml does not pin zip",
    ]);
  });
});

// ---- comment stripping that skips literals, and the purity rules -------------------------

/** Remove `//` and block comments, leaving string and template literals untouched. */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i] as string;
    const next = src[i + 1];
    if (ch === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i += 1;
    } else if (ch === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== ch) j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/** Module specifiers imported by a source text (static, dynamic, side-effect and re-export). */
function importSpecifiers(src: string): string[] {
  const out: string[] = [];
  const re =
    /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\(\s*)["']([^"']+)["']/g;
  for (let m = re.exec(src); m; m = re.exec(src)) out.push(m[1] as string);
  return out;
}

const URL_RE = /https?:\/\//;
const CORE_FORBIDDEN =
  /\b(?:document|window)\.[A-Za-z_$]|\bfetch\(|XMLHttpRequest|WebSocket/;
const UI_FORBIDDEN = /\bfetch\(|XMLHttpRequest|WebSocket/;

function coreProblems(files: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const [file, src] of Object.entries(files)) {
    for (const spec of importSpecifiers(src)) {
      if (/@tauri-apps|chord-render/.test(spec)) {
        problems.push(`${file} imports ${spec}`);
      }
    }
    if (URL_RE.test(src)) problems.push(`${file} contains a URL`);
    const hit = CORE_FORBIDDEN.exec(stripComments(src));
    if (hit) problems.push(`${file} uses ${hit[0]}`);
  }
  return problems;
}

function uiProblems(src: string): string[] {
  const problems: string[] = [];
  if (URL_RE.test(src)) problems.push("AiImportDialog.tsx contains a URL");
  const hit = UI_FORBIDDEN.exec(stripComments(src));
  if (hit) problems.push(`AiImportDialog.tsx uses ${hit[0]}`);
  return problems;
}

describe("the comment stripper", () => {
  it("removes comments but keeps literals", () => {
    const src = [
      "// fetch(x)",
      "/* WebSocket */ const a = 1;",
      'const b = "// not a comment fetch(";',
      "const c = `/* kept */ XMLHttpRequest`;",
      "const d = 'it\\'s // still a string';",
    ].join("\n");
    const out = stripComments(src);
    expect(out).not.toMatch(/fetch\(x\)/);
    expect(out).not.toMatch(/WebSocket/);
    expect(out).toContain('"// not a comment fetch("');
    expect(out).toContain("`/* kept */ XMLHttpRequest`");
    expect(out).toContain("'it\\'s // still a string'");
  });
});

// ---- (d) chord-core purity ---------------------------------------------------------------

function indexProblems(src: string): string[] {
  return ["documentText", "aiPrompt", "aiReply", "import"]
    .filter((m) => !src.includes(`export * from "./${m}";`))
    .map((m) => `index lacks export ./${m}`);
}

describe("(d) chord-core exports and purity of the document and AI modules", () => {
  const core = Object.fromEntries(CORE_FILES.map((f) => [f, read(f)]));

  it("index exports ./documentText, ./aiPrompt, ./aiReply and ./import", () => {
    expect(indexProblems(read(CORE_INDEX))).toEqual([]);
  });

  it("the three modules have no Tauri or chord-render import, no URL, and no DOM or network use", () => {
    expect(Object.keys(core)).toHaveLength(3);
    expect(coreProblems(core)).toEqual([]);
  });

  it("negative: each kind of violation is reported", () => {
    const file = CORE_FILES[0];
    const src = core[file] as string;
    const run = (extra: string): string[] =>
      coreProblems({ ...core, [file]: `${extra}\n${src}` });
    expect(run('import { x } from "@tauri-apps/api/core";')).toEqual([
      `${file} imports @tauri-apps/api/core`,
    ]);
    expect(run('import { x } from "chord-render";')).toEqual([
      `${file} imports chord-render`,
    ]);
    // A URL is seen even inside a string literal, and inside a comment.
    expect(run('const u = "https://example.test";')).toEqual([
      `${file} contains a URL`,
    ]);
    expect(run("// see http://example.test")).toEqual([
      `${file} contains a URL`,
    ]);
    expect(run("const t = document.title;")).toEqual([
      `${file} uses document.t`,
    ]);
    expect(run("const w = window.location;")).toEqual([
      `${file} uses window.l`,
    ]);
    expect(run("void fetch(1);")).toEqual([`${file} uses fetch(`]);
    expect(run("const x = new XMLHttpRequest();")).toEqual([
      `${file} uses XMLHttpRequest`,
    ]);
    expect(run("const s = new WebSocket(x);")).toEqual([
      `${file} uses WebSocket`,
    ]);
    // Mentions inside comments are not code.
    expect(run("// fetch( and document.title and WebSocket")).toEqual([]);
    // A "//" inside a string literal does not start a comment, so a violation after it is seen.
    expect(run('const m = "a // b"; void fetch(1);')).toEqual([
      `${file} uses fetch(`,
    ]);
    expect(run('const m = "a // b";')).toEqual([]);
  });

  it("negative: an index without an export is reported", () => {
    const index = read(CORE_INDEX);
    const mutated = index.replace('export * from "./aiReply";', "");
    expect(mutated).not.toBe(index);
    expect(indexProblems(mutated)).toEqual(["index lacks export ./aiReply"]);
    const noImport = index.replace('export * from "./import";', "");
    expect(noImport).not.toBe(index);
    expect(indexProblems(noImport)).toEqual(["index lacks export ./import"]);
  });
});

// ---- (e) prompt delimiter ----------------------------------------------------------------

function promptProblems(prompts: string[], delimiter: string): string[] {
  const problems: string[] = [];
  if (delimiter !== "{new_song}") problems.push("delimiter is not {new_song}");
  prompts.forEach((p, i) => {
    if (!p.includes(delimiter))
      problems.push(`prompt ${i} lacks the delimiter`);
  });
  return problems;
}

describe("(e) the prompt names the song delimiter", () => {
  const prompts = [
    buildAiPrompt({ mode: "text", text: "Am G\nhello there" }),
    buildAiPrompt({ mode: "attach" }),
  ];

  it("both modes contain AI_SONG_DELIMITER and it is {new_song}", () => {
    expect(AI_SONG_DELIMITER).toBe("{new_song}");
    expect(promptProblems(prompts, AI_SONG_DELIMITER)).toEqual([]);
  });

  it("negative: a prompt without the delimiter or another delimiter is reported", () => {
    expect(promptProblems(["no marker"], AI_SONG_DELIMITER)).toEqual([
      "prompt 0 lacks the delimiter",
    ]);
    expect(promptProblems(prompts, "{next}")).toContain(
      "delimiter is not {new_song}",
    );
  });
});

// ---- (f) no network code in the AI import UI ---------------------------------------------

describe("(f) the AI import dialog has no network code", () => {
  it("has no URL, fetch(, XMLHttpRequest or WebSocket", () => {
    expect(uiProblems(read(AI_DIALOG))).toEqual([]);
  });

  it("negative: each violation is reported, comments and literals are not", () => {
    const src = read(AI_DIALOG);
    expect(uiProblems(`${src}\nconst u = "https://example.test";`)).toEqual([
      "AiImportDialog.tsx contains a URL",
    ]);
    expect(uiProblems(`${src}\nvoid fetch(1);`)).toEqual([
      "AiImportDialog.tsx uses fetch(",
    ]);
    expect(uiProblems(`${src}\nnew XMLHttpRequest();`)).toEqual([
      "AiImportDialog.tsx uses XMLHttpRequest",
    ]);
    expect(uiProblems(`${src}\nnew WebSocket(x);`)).toEqual([
      "AiImportDialog.tsx uses WebSocket",
    ]);
    expect(uiProblems(`${src}\n// fetch( WebSocket`)).toEqual([]);
  });
});

// ---- (g) test ids documented -------------------------------------------------------------

function testIdsOf(src: string): string[] {
  return [...src.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1] as string);
}

function documentedIds(md: string): Set<string> {
  const section = md.split(/^## Test ids\s*$/m)[1] ?? "";
  const body = section.split(/^## /m)[0] ?? "";
  return new Set(
    [...body.matchAll(/^\|\s*`([^`]+)`/gm)].map((m) => m[1] as string),
  );
}

function undocumentedProblems(src: string, md: string): string[] {
  const docs = documentedIds(md);
  return testIdsOf(src)
    .filter((id) => !docs.has(id))
    .map((id) => `${id} is not in docs/DESKTOP.md ## Test ids`);
}

describe("(g) every dialog test id is documented", () => {
  it("each data-testid of AiImportDialog.tsx is in DESKTOP.md ## Test ids", () => {
    expect(testIdsOf(read(AI_DIALOG)).length).toBeGreaterThan(10);
    expect(undocumentedProblems(read(AI_DIALOG), read(DESKTOP_DOC))).toEqual(
      [],
    );
  });

  it("negative: a new test id and a removed documentation row are reported", () => {
    const src = read(AI_DIALOG);
    const md = read(DESKTOP_DOC);
    expect(
      undocumentedProblems(`${src}\n<i data-testid="ai-new-thing" />`, md),
    ).toEqual(["ai-new-thing is not in docs/DESKTOP.md ## Test ids"]);
    const stripped = md.replace(/^\|\s*`ai-copy-failed`[^\n]*\n/m, "");
    expect(stripped).not.toBe(md);
    expect(undocumentedProblems(src, stripped)).toEqual([
      "ai-copy-failed is not in docs/DESKTOP.md ## Test ids",
    ]);
  });
});
