// Cross-workspace contract: docs/STACK.md <-> pnpm catalog <-> pnpm-lock.yaml <-> Cargo.lock.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const read = (rel: string): string =>
  readFileSync(path.join(repoRoot, rel), "utf8");

interface StackRow {
  component: string;
  pkg: string;
  version: string;
  ecosystem: string;
  status: string;
}

const INSTALLED = "installed (G0)";

/** Parse the `## Pinned versions` table; tolerates prettier column padding. */
function parseStackTable(markdown: string): StackRow[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Pinned versions\s*$/.test(l));
  if (start < 0) {
    throw new Error("docs/STACK.md: '## Pinned versions' header is missing");
  }
  const tableLines: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const t = line.trim();
    if (t.startsWith("|")) tableLines.push(t);
    else if (tableLines.length > 0) break;
  }
  const cells = (l: string): string[] =>
    l
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
  const [header, , ...body] = tableLines;
  if (!header) {
    throw new Error("docs/STACK.md: '## Pinned versions' has no table");
  }
  const expected = ["Component", "Package", "Version", "Ecosystem", "Status"];
  if (cells(header).join("|") !== expected.join("|")) {
    throw new Error(
      `docs/STACK.md: unexpected table header '${cells(header).join(" | ")}'`,
    );
  }
  return body.map((l) => {
    const c = cells(l);
    return {
      component: c[0] ?? "",
      pkg: (c[1] ?? "").replace(/`/g, ""),
      version: c[2] ?? "",
      ecosystem: c[3] ?? "",
      status: c[4] ?? "",
    };
  });
}

const unquote = (s: string): string => s.replace(/^["']|["']$/g, "");

/** Line-based parser for the `catalog:` block of pnpm-workspace.yaml. */
function parseCatalog(yamlText: string): Record<string, string> {
  const out: Record<string, string> = {};
  let inBlock = false;
  for (const line of yamlText.split(/\r?\n/)) {
    if (/^catalog:\s*$/.test(line)) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    if (/^\S/.test(line)) break;
    const m = /^\s+(\S.*?):\s+(\S+)\s*$/.exec(line);
    if (m && m[1] && m[2]) out[unquote(m[1])] = unquote(m[2]);
  }
  return out;
}

/** Resolved versions of `catalogs: default:` in pnpm-lock.yaml (peer suffix stripped). */
function parseLockCatalog(lockText: string): Record<string, string> {
  const out: Record<string, string> = {};
  let state: "none" | "catalogs" | "default" = "none";
  let current: string | undefined;
  for (const line of lockText.split(/\r?\n/)) {
    if (/^catalogs:\s*$/.test(line)) {
      state = "catalogs";
      continue;
    }
    if (state === "none") continue;
    if (/^\S/.test(line)) break;
    if (/^ {2}default:\s*$/.test(line)) {
      state = "default";
      continue;
    }
    if (state !== "default") continue;
    const key = /^ {4}(\S.*?):\s*$/.exec(line);
    if (key && key[1]) {
      current = unquote(key[1]);
      continue;
    }
    const ver = /^ {6}version:\s+(\S+)\s*$/.exec(line);
    if (ver && ver[1] && current) {
      out[current] = unquote(ver[1]).replace(/\(.*$/, "");
    }
  }
  return out;
}

/** name -> all resolved versions found in a Cargo.lock. */
function parseCargoLock(lockText: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const block of lockText.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const name = /^name = "([^"]+)"/m.exec(block)?.[1];
    const version = /^version = "([^"]+)"/m.exec(block)?.[1];
    if (!name || !version) continue;
    out.set(name, [...(out.get(name) ?? []), version]);
  }
  return out;
}

interface Sources {
  rows: StackRow[];
  catalog: Record<string, string>;
  lockCatalog: Record<string, string>;
  cargoLock: Map<string, string[]>;
}

/** Compare installed npm/crate rows against catalog and lockfiles; returns mismatch messages. */
function compareStack({
  rows,
  catalog,
  lockCatalog,
  cargoLock,
}: Sources): string[] {
  const problems: string[] = [];
  for (const row of rows) {
    if (row.status !== INSTALLED) continue;
    if (row.ecosystem === "npm") {
      if (catalog[row.pkg] !== row.version) {
        problems.push(
          `${row.pkg}: STACK.md ${row.version} != catalog ${catalog[row.pkg] ?? "(missing)"}`,
        );
      }
      if (lockCatalog[row.pkg] !== row.version) {
        problems.push(
          `${row.pkg}: STACK.md ${row.version} != pnpm-lock ${lockCatalog[row.pkg] ?? "(missing)"}`,
        );
      }
    } else if (row.ecosystem === "crate") {
      const resolved = cargoLock.get(row.pkg) ?? [];
      if (!resolved.includes(row.version)) {
        problems.push(
          `${row.pkg}: STACK.md ${row.version} != Cargo.lock ${resolved.join(",") || "(missing)"}`,
        );
      }
    }
  }
  for (const name of Object.keys(catalog)) {
    const row = rows.find((r) => r.pkg === name && r.ecosystem === "npm");
    if (!row || row.status !== INSTALLED) {
      problems.push(`${name}: in catalog but no '${INSTALLED}' STACK.md row`);
    }
  }
  return problems;
}

const stackMd = read("docs/STACK.md");
const rows = parseStackTable(stackMd);
const catalog = parseCatalog(read("pnpm-workspace.yaml"));
const lockCatalog = parseLockCatalog(read("pnpm-lock.yaml"));
const cargoLock = parseCargoLock(read("apps/desktop/src-tauri/Cargo.lock"));
const sources: Sources = { rows, catalog, lockCatalog, cargoLock };
const installed = rows.filter((r) => r.status === INSTALLED);

describe("STACK.md parsing", () => {
  it("fails loudly when the Pinned versions header is missing", () => {
    expect(() => parseStackTable("# Stack\n\n| a | b |\n")).toThrow(
      /Pinned versions/,
    );
  });

  it("tolerates prettier padding and trims cells", () => {
    const md = [
      "## Pinned versions",
      "",
      "| Component | Package   | Version | Ecosystem | Status         |",
      "| --------- | --------- | ------- | --------- | -------------- |",
      "| Thing     | `thing`   | 1.2.3   | npm       | installed (G0) |",
    ].join("\n");
    expect(parseStackTable(md)).toEqual([
      {
        component: "Thing",
        pkg: "thing",
        version: "1.2.3",
        ecosystem: "npm",
        status: INSTALLED,
      },
    ]);
  });

  it("parses the real table with every installed ecosystem represented", () => {
    expect(installed.length).toBeGreaterThan(30);
    for (const eco of ["toolchain", "npm", "crate"]) {
      expect(installed.some((r) => r.ecosystem === eco)).toBe(true);
    }
  });

  it("parses catalog and lockfile sources non-vacuously", () => {
    expect(Object.keys(catalog).length).toBeGreaterThan(20);
    expect(Object.keys(lockCatalog).sort()).toEqual(
      Object.keys(catalog).sort(),
    );
    expect(cargoLock.get("tauri")?.length).toBeGreaterThan(0);
  });
});

describe("STACK.md consistency with pnpm and cargo", () => {
  it("every installed npm row equals the catalog and the pnpm-lock resolution", () => {
    const npmRows = installed.filter((r) => r.ecosystem === "npm");
    expect(npmRows.length).toBeGreaterThan(20);
    for (const row of npmRows) {
      expect(catalog[row.pkg], `catalog ${row.pkg}`).toBe(row.version);
      expect(lockCatalog[row.pkg], `pnpm-lock ${row.pkg}`).toBe(row.version);
    }
  });

  it("every installed crate row equals the Cargo.lock resolution", () => {
    const crateRows = installed.filter((r) => r.ecosystem === "crate");
    expect(crateRows.map((r) => r.pkg).sort()).toEqual(
      ["serde", "serde_json", "tauri", "tauri-build"].sort(),
    );
    for (const row of crateRows) {
      expect(cargoLock.get(row.pkg), `Cargo.lock ${row.pkg}`).toContain(
        row.version,
      );
    }
  });

  it("every catalog entry has an installed STACK.md row (no undocumented installs)", () => {
    for (const name of Object.keys(catalog)) {
      const row = rows.find((r) => r.pkg === name && r.ecosystem === "npm");
      expect(row?.status, `row for ${name}`).toBe(INSTALLED);
    }
  });

  it("the full comparison reports no mismatches", () => {
    expect(compareStack(sources)).toEqual([]);
  });

  it("pnpm row equals packageManager in package.json", () => {
    const pkg = JSON.parse(read("package.json")) as { packageManager: string };
    const pnpmRow = installed.find((r) => r.pkg === "pnpm");
    expect(pnpmRow).toBeDefined();
    expect(pkg.packageManager).toBe(`pnpm@${pnpmRow?.version}`);
  });

  it("tauri crate, @tauri-apps/api and @tauri-apps/cli share major.minor", () => {
    const mm = (pkg: string): string => {
      const v = installed.find((r) => r.pkg === pkg)?.version ?? "";
      const [maj, min] = v.split(".");
      return `${maj}.${min}`;
    };
    expect(mm("tauri")).toMatch(/^\d+\.\d+$/);
    expect(mm("@tauri-apps/api")).toBe(mm("tauri"));
    expect(mm("@tauri-apps/cli")).toBe(mm("tauri"));
  });

  it("no installed row is a pre-release", () => {
    for (const row of installed) {
      expect(row.version, row.pkg).not.toMatch(/-(alpha|beta|rc)/i);
    }
  });

  it("no version cell uses a range, wildcard or 'latest'", () => {
    for (const row of rows) {
      expect(row.version, row.pkg).not.toBe("");
      expect(row.version, row.pkg).not.toMatch(/[\^~*]/);
      expect(row.version, row.pkg).not.toMatch(/(^|[.-])x([.-]|$)/i);
      expect(row.version, row.pkg).not.toMatch(/latest/i);
    }
  });
});

describe("compareStack is not vacuous", () => {
  it("reports an npm version drift against the catalog and the lock", () => {
    const drifted = rows.map((r) =>
      r.pkg === "react" ? { ...r, version: "19.0.0" } : r,
    );
    const problems = compareStack({ ...sources, rows: drifted });
    expect(problems).toContain("react: STACK.md 19.0.0 != catalog 19.3.1");
    expect(problems).toContain("react: STACK.md 19.0.0 != pnpm-lock 19.3.1");
  });

  it("reports a crate version drift against Cargo.lock", () => {
    const drifted = rows.map((r) =>
      r.pkg === "serde" ? { ...r, version: "1.0.0" } : r,
    );
    const problems = compareStack({ ...sources, rows: drifted });
    expect(problems).toEqual(["serde: STACK.md 1.0.0 != Cargo.lock 1.0.229"]);
  });

  it("reports an undocumented catalog install", () => {
    const problems = compareStack({
      ...sources,
      catalog: { ...catalog, "left-pad": "1.0.0" },
    });
    expect(problems).toContain(
      "left-pad: in catalog but no 'installed (G0)' STACK.md row",
    );
  });

  it("catches drift injected into a STACK.md string via the parser", () => {
    const mutated = stackMd.replace(/(\| `vitest`\s+\| )5\.1\.0/, "$16.0.0");
    expect(mutated).not.toBe(stackMd);
    const problems = compareStack({
      ...sources,
      rows: parseStackTable(mutated),
    });
    expect(problems).toContain("vitest: STACK.md 6.0.0 != catalog 5.1.0");
  });

  it("detects mismatching in-memory lock strings", () => {
    const lock = parseLockCatalog(
      "catalogs:\n  default:\n    react:\n      specifier: 19.3.1\n      version: 19.2.0(foo@1)\n",
    );
    expect(lock).toEqual({ react: "19.2.0" });
    const problems = compareStack({
      rows: [
        {
          component: "React",
          pkg: "react",
          version: "19.3.1",
          ecosystem: "npm",
          status: INSTALLED,
        },
      ],
      catalog: { react: "19.3.1" },
      lockCatalog: lock,
      cargoLock: new Map(),
    });
    expect(problems).toEqual(["react: STACK.md 19.3.1 != pnpm-lock 19.2.0"]);
  });
});
