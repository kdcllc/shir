import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import stylelint from "stylelint";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const configFile = path.join(repoRoot, "stylelint.config.mjs");

async function styleErrors(decl: string): Promise<number> {
  const res = await stylelint.lint({
    code: `a {\n  ${decl};\n}\n`,
    codeFilename: path.join(repoRoot, "x.css"),
    configFile,
  });
  return (res.results[0]?.warnings ?? []).filter((w) => w.severity === "error")
    .length;
}

describe("stylelint logical-only rules", () => {
  const banned = [
    "margin-left: 0",
    "padding-right: 1px",
    "left: 0",
    "border-left: 1px solid",
    "text-align: right",
    "float: left",
    "margin: 0 1px 0 2px",
    "padding: 1px 2px 3px 4px",
    "inset: 0 auto auto 0",
    "border-radius: 4px 0 0 4px",
    "border-radius: 4px / 2px 3px",
    "margin: calc(1px + 2px) 0 calc(3px - 1px) 0",
  ];
  const allowed = [
    "margin-inline-start: 0",
    "inset-inline-start: 0",
    "text-align: start",
    "top: 0",
    "width: 10px",
    "margin: 0 auto",
    "padding: 1px 2px 3px",
    "border-radius: 4px",
    "border-radius: 50% / 10%",
    "border-radius: calc(1px + 2px)",
    "margin: calc(1px + 2px) 0",
  ];

  it.each(banned)("rejects %s", async (decl) => {
    expect(await styleErrors(decl)).toBeGreaterThanOrEqual(1);
  });

  it.each(allowed)("allows %s", async (decl) => {
    expect(await styleErrors(decl)).toBe(0);
  });
});

describe("eslint Tauri import fence", () => {
  const eslint = new ESLint({ cwd: repoRoot });
  const code = "import { invoke } from '@tauri-apps/api/core';\nvoid invoke;\n";

  async function restricted(file: string): Promise<number> {
    const [res] = await eslint.lintText(code, {
      filePath: path.join(repoRoot, file),
    });
    return (res?.messages ?? []).filter(
      (m) => m.ruleId === "no-restricted-imports",
    ).length;
  }

  it("errors in chord-core", async () => {
    expect(await restricted("packages/chord-core/src/x.ts")).toBe(1);
  });
  it("errors in chord-render", async () => {
    expect(await restricted("packages/chord-render/src/x.tsx")).toBe(1);
  });
  it("is not applied to apps/desktop", async () => {
    expect(await restricted("apps/desktop/src/x.ts")).toBe(0);
  });
});
