// G8 cross-task contract: STRINGS is read only by the i18n layer, no `:lang(` selectors, EN/HE
// resources stay in parity, and every test id added by this goal is documented.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EN } from "../apps/desktop/src/i18n/en";
import { HE } from "../apps/desktop/src/i18n/he";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const read = (rel: string): string =>
  readFileSync(path.join(repoRoot, rel), "utf8");

const DESKTOP_SRC = "apps/desktop/src";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(repoRoot, dir))) {
    if (name === "node_modules") continue;
    const rel = `${dir}/${name}`;
    if (statSync(path.join(repoRoot, rel)).isDirectory())
      out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}

const allFiles = walk(DESKTOP_SRC);
const isTest = (rel: string): boolean => /\.test\.tsx?$/.test(rel);

/** Non-test `.ts` / `.tsx` sources that may not read `STRINGS`. */
const isStringsGuarded = (rel: string): boolean =>
  /\.tsx?$/.test(rel) &&
  !isTest(rel) &&
  rel !== `${DESKTOP_SRC}/strings.ts` &&
  !rel.startsWith(`${DESKTOP_SRC}/i18n/`);

function stringsUsers(sources: Record<string, string>): string[] {
  return Object.entries(sources)
    .filter(([rel, text]) => isStringsGuarded(rel) && /\bSTRINGS\b/.test(text))
    .map(([rel]) => rel);
}

function langSelectorFiles(sources: Record<string, string>): string[] {
  return Object.entries(sources)
    .filter(([rel, text]) => rel.endsWith(".css") && /:lang\(/.test(text))
    .map(([rel]) => rel);
}

// ---- (c) parity, independently implemented -----------------------------------------------

const FSI = "\u2068";
const PDI = "\u2069";
type Resource = Record<string, string>;

const vars = (value: string): Set<string> =>
  new Set([...value.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]!));

/** Returns one message per parity violation; empty when `he` fully satisfies the rule. */
function parityViolations(en: Resource, he: Resource): string[] {
  const bad: string[] = [];
  const bases = Object.keys(en)
    .filter((k) => k.endsWith("_one") && `${k.slice(0, -4)}_other` in en)
    .map((k) => k.slice(0, -4));
  const isBase = (b: string): boolean => bases.includes(b);

  for (const key of Object.keys(en))
    if (!(key in he)) bad.push(`HE lacks EN key ${key}`);
  for (const key of Object.keys(he)) {
    const m = /^(.+)_(two|many)$/.exec(key);
    if (!(key in en) && !(m !== null && isBase(m[1]!)))
      bad.push(`HE has stray key ${key}`);
  }
  for (const base of bases)
    for (const form of ["one", "two", "many", "other"])
      if (!(`${base}_${form}` in he)) bad.push(`HE lacks ${base}_${form}`);
  for (const [key, value] of Object.entries(he))
    if (typeof value !== "string" || value.trim() === "")
      bad.push(`HE ${key} is empty`);

  const needs = (
    heKey: string,
    names: Iterable<string>,
    skipCount: boolean,
  ) => {
    const value = he[heKey];
    if (typeof value !== "string") return;
    for (const name of names) {
      if (skipCount && name === "count") continue;
      if (!vars(value).has(name)) bad.push(`HE ${heKey} lacks {{${name}}}`);
    }
  };
  for (const [key, value] of Object.entries(en)) {
    const base = key.replace(/_(one|other)$/, "");
    if (!isBase(base)) {
      needs(key, vars(value), false);
    } else if (key.endsWith("_one")) {
      // Number words may replace {{count}} in the singular and the dual only.
      needs(key, vars(value), true);
      needs(`${base}_two`, vars(value), true);
    } else {
      // _other and _many carry every placeholder, {{count}} included (the _many gap found in B30).
      needs(key, vars(value), false);
      needs(`${base}_many`, vars(value), false);
    }
  }

  for (const [key, value] of Object.entries(he)) {
    const open = value.split(FSI).length - 1;
    const close = value.split(PDI).length - 1;
    if (open !== close) bad.push(`HE ${key} has unbalanced isolates`);
    for (const m of value.matchAll(/\{\{title\}\}/g)) {
      const at = m.index!;
      if (value[at - 1] !== FSI || value[at + "{{title}}".length] !== PDI)
        bad.push(`HE ${key} {{title}} is not wrapped in FSI/PDI`);
    }
  }
  // Wrapped in EN means wrapped in HE.
  for (const [key, value] of Object.entries(en))
    if (value.includes(`${FSI}{{title}}${PDI}`) && key in he)
      if (!he[key]!.includes(`${FSI}{{title}}${PDI}`))
        bad.push(`HE ${key} dropped the FSI/PDI around {{title}}`);
  return bad;
}

// ---- (d) test ids ------------------------------------------------------------------------

/** Test ids this goal added (goal.md / task reports). */
const G8_TEST_IDS = [
  "library-sort",
  "library-filter-all",
  "library-filter-he",
  "library-filter-en",
  "library-filter-mixed",
  "filter-empty",
  "song-row-key",
  "song-language",
  "locale-toggle",
  "locale-he",
  "locale-en",
  "row-add-chord",
] as const;

function testIdSection(doc: string): string {
  const start = doc.indexOf("\n## Test ids");
  if (start === -1) return "";
  const rest = doc.slice(start + 1);
  const next = rest.indexOf("\n## ", 1);
  return next === -1 ? rest : rest.slice(0, next);
}

function undocumented(ids: readonly string[], doc: string): string[] {
  const section = testIdSection(doc);
  const rows = new Set(
    [...section.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((m) => m[1]!),
  );
  return ids.filter((id) => !rows.has(id));
}

// ---- tests -------------------------------------------------------------------------------

const sources: Record<string, string> = Object.fromEntries(
  allFiles
    .filter((rel) => /\.(tsx?|css)$/.test(rel))
    .map((rel) => [rel, read(rel)] as const),
);

describe("the scan covers the desktop sources", () => {
  it("sees components, css and the i18n layer", () => {
    for (const rel of [
      `${DESKTOP_SRC}/App.tsx`,
      `${DESKTOP_SRC}/App.module.css`,
      `${DESKTOP_SRC}/strings.ts`,
      `${DESKTOP_SRC}/i18n/en.ts`,
      `${DESKTOP_SRC}/components/LibraryControls.tsx`,
    ])
      expect(Object.keys(sources)).toContain(rel);
    expect(isStringsGuarded(`${DESKTOP_SRC}/App.tsx`)).toBe(true);
    expect(isStringsGuarded(`${DESKTOP_SRC}/App.test.tsx`)).toBe(false);
    expect(isStringsGuarded(`${DESKTOP_SRC}/strings.ts`)).toBe(false);
    expect(isStringsGuarded(`${DESKTOP_SRC}/i18n/en.ts`)).toBe(false);
  });
});

describe("(a) STRINGS is read only by strings.ts and src/i18n", () => {
  it("no other non-test source references it", () => {
    expect(stringsUsers(sources)).toEqual([]);
  });

  it("self-test: an injected reference is reported, an allowed one is not", () => {
    const injected = {
      ...sources,
      [`${DESKTOP_SRC}/components/Injected.tsx`]: "const x = STRINGS.save;",
    };
    expect(stringsUsers(injected)).toEqual([
      `${DESKTOP_SRC}/components/Injected.tsx`,
    ]);
    expect(
      stringsUsers({
        [`${DESKTOP_SRC}/i18n/en.ts`]: "STRINGS",
        [`${DESKTOP_SRC}/strings.ts`]: "STRINGS",
        [`${DESKTOP_SRC}/App.test.tsx`]: "STRINGS",
      }),
    ).toEqual([]);
  });
});

describe("(b) no :lang( selector in any desktop stylesheet", () => {
  it("finds none", () => {
    expect(langSelectorFiles(sources)).toEqual([]);
  });

  it("self-test: an injected selector is reported", () => {
    expect(
      langSelectorFiles({
        ...sources,
        [`${DESKTOP_SRC}/Injected.module.css`]: ".a:lang(he) { color: red }",
        [`${DESKTOP_SRC}/Plain.module.css`]: ".a { color: red }",
      }),
    ).toEqual([`${DESKTOP_SRC}/Injected.module.css`]);
  });
});

describe("(c) EN / HE parity", () => {
  const en = EN as Resource;
  const he = HE as Resource;

  it("HE satisfies the rule", () => {
    expect(parityViolations(en, he)).toEqual([]);
  });

  it("has the plural bases the rule is about", () => {
    const bases = Object.keys(en).filter((k) => k.endsWith("_one"));
    expect(bases.length).toBe(9);
    expect(vars(en["deleteManyFailed_other"]!)).toEqual(
      new Set(["failed", "count"]),
    );
  });

  const mutate = (patch: (copy: Resource) => void): string[] => {
    const copy = { ...he };
    patch(copy);
    return parityViolations(en, copy);
  };

  it("self-test: a missing key is reported", () => {
    expect(mutate((c) => delete c["save"])).toContain("HE lacks EN key save");
  });
  it("self-test: a stray key is reported", () => {
    expect(mutate((c) => (c["bogus"] = "x"))).toContain(
      "HE has stray key bogus",
    );
  });
  it("self-test: a missing plural form is reported", () => {
    expect(mutate((c) => delete c["deletedCount_many"])).toContain(
      "HE lacks deletedCount_many",
    );
  });
  it("self-test: an empty value is reported", () => {
    expect(mutate((c) => (c["save"] = "  "))).toContain("HE save is empty");
  });
  it("self-test: _many without {{count}} is reported", () => {
    expect(mutate((c) => (c["importQueued_many"] = "קבצים"))).toContain(
      "HE importQueued_many lacks {{count}}",
    );
  });
  it("self-test: _many without a non-count placeholder is reported (B30)", () => {
    expect(
      mutate((c) => (c["deleteManyFailed_many"] = "נכשלו {{count}}")),
    ).toContain("HE deleteManyFailed_many lacks {{failed}}");
  });
  it("self-test: _one / _two may drop {{count}} but not {{saved}}", () => {
    expect(mutate((c) => (c["importSummary_one"] = "יובא קובץ אחד"))).toContain(
      "HE importSummary_one lacks {{saved}}",
    );
    expect(
      mutate((c) => (c["importSummary_two"] = "יובאו מתוך שני קבצים")),
    ).toContain("HE importSummary_two lacks {{saved}}");
    expect(
      mutate((c) => (c["importSummary_one"] = "יובא {{saved}} מתוך קובץ אחד")),
    ).toEqual([]);
  });
  it("self-test: a lost placeholder in a plain key is reported", () => {
    expect(mutate((c) => (c["lineLabel"] = "שורה"))).toContain(
      "HE lineLabel lacks {{n}}",
    );
  });
  it("self-test: an unbalanced isolate is reported", () => {
    expect(
      mutate((c) => (c["deleteSongNamed"] = `מחק ${FSI}{{title}}`)),
    ).toContain("HE deleteSongNamed has unbalanced isolates");
  });
  it("self-test: an unwrapped {{title}} is reported", () => {
    const out = mutate((c) => (c["deleteConfirmTitle"] = "למחוק {{title}}?"));
    expect(out).toContain(
      "HE deleteConfirmTitle {{title}} is not wrapped in FSI/PDI",
    );
    expect(out).toContain(
      "HE deleteConfirmTitle dropped the FSI/PDI around {{title}}",
    );
  });
});

describe("(d) every test id added by G8 is documented", () => {
  const doc = read("docs/DESKTOP.md");

  it("the Test ids section exists", () => {
    expect(testIdSection(doc)).toContain("`song-list`");
  });

  it("lists every G8 id", () => {
    expect(undocumented(G8_TEST_IDS, doc)).toEqual([]);
  });

  it("each G8 id exists in a desktop source", () => {
    const text = Object.entries(sources)
      .filter(([rel]) => !isTest(rel) && rel.endsWith(".tsx"))
      .map(([, t]) => t)
      .join("\n");
    for (const id of G8_TEST_IDS) {
      const prefix = id.startsWith("library-filter-") ? "library-filter-" : id;
      expect(text, id).toContain(prefix);
    }
  });

  it("self-test: an undocumented id is reported, a documented one is not", () => {
    expect(undocumented([...G8_TEST_IDS, "brand-new-id"], doc)).toEqual([
      "brand-new-id",
    ]);
    // An id that only appears outside the Test ids section does not count.
    const moved = doc.replace("| `library-sort`", "| `library-sorted`");
    expect(undocumented(G8_TEST_IDS, moved)).toEqual(["library-sort"]);
    const elsewhere = `${doc.replace("| `locale-he`", "| `locale-hx`")}\n\`locale-he\``;
    expect(undocumented(["locale-he"], elsewhere)).toEqual(["locale-he"]);
  });
});
