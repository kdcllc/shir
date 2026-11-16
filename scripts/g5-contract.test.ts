// G5 cross-artifact contract: bindings SearchHit, seed corpus <-> disk, .local/ boundary, migrations.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const read = (rel: string): string =>
  readFileSync(path.join(repoRoot, rel), "utf8");

const SEED_RS = "apps/desktop/src-tauri/src/db/seed.rs";
const SEED_DIR = "apps/desktop/src-tauri/src/db";
// sha256 of migrations/0001_init.sql, computed once from commit 0b3855b (no git history needed).
const V1_SHA256 =
  "8da80a0f8d5b1c7328eea18461e5bcf0f6ad1c975573849217e72188c78fec14";

const sorted = (xs: string[]): string[] => [...xs].sort();
const posix = (p: string): string => p.split(path.sep).join("/");

// ---- (a) bindings ----------------------------------------------------------------------

/** Body of `export type <name> = { ... };`, or undefined. */
function typeBody(src: string, name: string): string | undefined {
  const m = new RegExp(`export type ${name} = \\{([\\s\\S]*?)\\n\\};`).exec(
    src,
  );
  return m?.[1];
}

function searchHitProblems(src: string): string[] {
  const problems: string[] = [];
  const ser = typeBody(src, "SearchHit_Serialize");
  if (ser === undefined) problems.push("SearchHit_Serialize missing");
  else if (!/\bsnippet: string \| null,/.test(ser))
    problems.push("SearchHit_Serialize.snippet is not `string | null`");
  if (!/export type SearchHit = SearchHit_Serialize \| /.test(src))
    problems.push("SearchHit union missing");
  if (
    !/^\tsearchSongs: .*typedError<SearchHit_Serialize\[\], DbError>/m.test(src)
  )
    problems.push("searchSongs is not typed with SearchHit_Serialize[]");
  return problems;
}

describe("(a) bindings.ts SearchHit", () => {
  const src = read("apps/desktop/src/bindings.ts");

  it("declares SearchHit with snippet: string | null and types searchSongs with it", () => {
    expect(searchHitProblems(src)).toEqual([]);
  });

  it("negative: a non-nullable snippet is reported", () => {
    const mutated = src.replace("snippet: string | null,", "snippet: string,");
    expect(mutated).not.toBe(src);
    expect(searchHitProblems(mutated).join("\n")).toContain("snippet");
  });

  it("negative: searchSongs typed with SongSummary is reported", () => {
    const mutated = src.replace(
      "typedError<SearchHit_Serialize[], DbError>",
      "typedError<SongSummary_Serialize[], DbError>",
    );
    expect(mutated).not.toBe(src);
    expect(searchHitProblems(mutated).join("\n")).toContain("searchSongs");
  });
});

// ---- (b) seed corpus <-> disk ----------------------------------------------------------

/** Repo-relative `/` paths of every literal path embedded by seed.rs. */
function seedPaths(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/\bsong!\("([^"]+)"\)/g)) out.push(m[1]!);
  for (const m of src.matchAll(/\binclude_str!\("([^"]+)"\)/g)) {
    out.push(posix(path.posix.normalize(`${SEED_DIR}/${m[1]!}`)));
  }
  return sorted(out.map((p) => p.replace(/\\/g, "/")));
}

function diskPaths(): string[] {
  const out: string[] = [];
  for (const dir of ["samples", "packages/test-fixtures/fixtures"]) {
    for (const name of readdirSync(path.join(repoRoot, dir))) {
      if (name.endsWith(".cho") && !name.endsWith(".canonical.cho")) {
        out.push(`${dir}/${name}`);
      }
    }
  }
  return sorted(out);
}

function seedProblems(src: string, disk: string[]): string[] {
  const problems: string[] = [];
  const embedded = seedPaths(src);
  for (const p of embedded) {
    if (p.startsWith(".local/") || p.includes("/.local/"))
      problems.push(`seed embeds a .local/ path: ${p}`);
  }
  const missing = disk.filter((p) => !embedded.includes(p));
  const extra = embedded.filter((p) => !disk.includes(p));
  if (missing.length) problems.push(`seed is missing: ${missing.join(",")}`);
  if (extra.length) problems.push(`seed has extra: ${extra.join(",")}`);
  return problems;
}

describe("(b) seed corpus equals the disk set", () => {
  const src = read(SEED_RS);
  const disk = diskPaths();

  it("every embedded path is on disk and every disk song is embedded", () => {
    expect(disk.length).toBeGreaterThanOrEqual(17);
    expect(seedProblems(src, disk)).toEqual([]);
    expect(seedPaths(src)).toEqual(disk);
  });

  it("negative: a seed source missing one path is reported", () => {
    const dropped = disk[0]!;
    const mutated = src
      .split("\n")
      .filter((l) => !l.includes(`"${dropped}"`))
      .join("\n");
    expect(mutated).not.toBe(src);
    expect(seedProblems(mutated, disk).join("\n")).toContain(
      `seed is missing: ${dropped}`,
    );
  });

  it("negative: a seed source including a .local/ path is reported", () => {
    const mutated = src.replace(
      "];\n\n/// The bundled",
      '    song!(".local/qa-songs/katamar-translit.cho"),\n];\n\n/// The bundled',
    );
    expect(mutated).not.toBe(src);
    const problems = seedProblems(mutated, disk).join("\n");
    expect(problems).toContain("seed embeds a .local/ path");
    expect(problems).toContain("seed has extra");
  });
});

// ---- (c) .local/ boundary --------------------------------------------------------------

const ignoresLocal = (gitignore: string): boolean =>
  gitignore
    .split(/\r?\n/)
    .map((l) => l.trim())
    .includes(".local/");

describe("(c) .local/ is ignored and untracked", () => {
  it(".gitignore has a .local/ line", () => {
    expect(ignoresLocal(read(".gitignore"))).toBe(true);
  });

  it("negative: a .gitignore without the line is detected", () => {
    const mutated = read(".gitignore").replace(/^\.local\/\r?\n/m, "");
    expect(mutated).not.toBe(read(".gitignore"));
    expect(ignoresLocal(mutated)).toBe(false);
  });

  it("git ls-files .local is empty", () => {
    const out = execFileSync("git", ["ls-files", ".local"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(out.trim()).toBe("");
  });
});

// ---- (d) migrations --------------------------------------------------------------------

const sha256 = (s: Buffer | string): string =>
  createHash("sha256").update(s).digest("hex");

describe("(d) migrations", () => {
  const dir = "apps/desktop/src-tauri/migrations";

  it("0002 creates app_meta", () => {
    expect(read(`${dir}/0002_app_meta_fts_rebuild.sql`)).toMatch(
      /CREATE TABLE app_meta\b/,
    );
  });

  it("0001_init.sql is byte-identical to the shipped V1", () => {
    const bytes = readFileSync(path.join(repoRoot, dir, "0001_init.sql"));
    // Normalize CRLF checkouts (core.autocrlf) before hashing.
    expect(sha256(bytes.toString("utf8").replace(/\r\n/g, "\n"))).toBe(
      V1_SHA256,
    );
  });

  it("negative: an edited 0001 changes the hash", () => {
    const bytes = readFileSync(path.join(repoRoot, dir, "0001_init.sql"));
    expect(sha256(Buffer.concat([bytes, Buffer.from("-- x\n")]))).not.toBe(
      V1_SHA256,
    );
  });
});
