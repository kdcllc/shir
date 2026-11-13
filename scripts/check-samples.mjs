// Samples licensing gate: every file under samples/ needs a row in samples/LICENSES.md.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Recursively list files under `dir`, as forward-slash paths relative to `root`.
 * @param {string} root
 * @param {string} dir
 * @returns {string[]}
 */
function walk(root, dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(root, full));
    } else {
      out.push(path.relative(root, full).split(path.sep).join("/"));
    }
  }
  return out;
}

/**
 * Files that must be listed: everything except LICENSES.md itself and .gitkeep.
 * @param {string} samplesDir
 * @returns {string[]}
 */
function listSampleFiles(samplesDir) {
  return walk(samplesDir, samplesDir).filter(
    (rel) => rel !== "LICENSES.md" && path.posix.basename(rel) !== ".gitkeep",
  );
}

/**
 * Backticked paths in the first cell of markdown table rows.
 * @param {string} markdown
 * @returns {string[]}
 */
function parseEntries(markdown) {
  /** @type {string[]} */
  const entries = [];
  for (const line of markdown.split(/\r?\n/)) {
    const cells = line.trim();
    if (!cells.startsWith("|")) continue;
    const first = cells.slice(1).split("|")[0] ?? "";
    for (const m of first.matchAll(/`([^`]+)`/g)) {
      if (m[1]) entries.push(m[1]);
    }
  }
  return entries;
}

/**
 * @param {string} samplesDir
 * @returns {{ unlisted: string[], stale: string[] }}
 */
export function checkSamples(samplesDir) {
  const files = listSampleFiles(samplesDir);
  const licensesPath = path.join(samplesDir, "LICENSES.md");
  const entries = existsSync(licensesPath)
    ? parseEntries(readFileSync(licensesPath, "utf8"))
    : [];
  const fileSet = new Set(files);
  const entrySet = new Set(entries);
  return {
    unlisted: files.filter((f) => !entrySet.has(f)).sort(),
    stale: entries.filter((e) => !fileSet.has(e)).sort(),
  };
}

/** CLI entry point; returns the process exit code. */
function main() {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const samplesDir = path.join(repoRoot, "samples");
  if (!existsSync(samplesDir)) {
    console.log("check:samples: no samples/ directory");
    return 0;
  }
  const files = listSampleFiles(samplesDir);
  if (!existsSync(path.join(samplesDir, "LICENSES.md"))) {
    if (files.length === 0) {
      console.log("check:samples: 0 file(s) OK");
      return 0;
    }
    console.error("check:samples: samples/LICENSES.md missing");
    return 1;
  }
  const { unlisted, stale } = checkSamples(samplesDir);
  for (const s of stale) console.error(`check:samples: stale entry ${s}`);
  if (unlisted.length > 0) {
    for (const u of unlisted)
      console.error(`check:samples: unlisted samples/${u}`);
    return 1;
  }
  console.log(`check:samples: ${files.length} file(s) OK`);
  return 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main();
}
