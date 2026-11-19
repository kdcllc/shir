import { readFileSync } from "node:fs";
import path from "node:path";

// test-fixtures' own readers resolve paths via import.meta.url, which jsdom
// breaks (/@fs/ URL); read the same files by a directory-relative path instead.
const FIXTURES_DIR = path.resolve(
  import.meta.dirname,
  "../../../test-fixtures/fixtures",
);

/** UTF-8 source of fixture `name`; works under jsdom. */
export const readFixture = (name: string): string =>
  readFileSync(path.join(FIXTURES_DIR, `${name}.cho`), "utf8");

/** Parsed golden JSON of fixture `name`; works under jsdom. */
export const readGolden = (name: string): unknown =>
  JSON.parse(
    readFileSync(path.join(FIXTURES_DIR, `${name}.golden.json`), "utf8"),
  );
