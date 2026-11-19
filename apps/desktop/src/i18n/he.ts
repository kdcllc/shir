import { EN } from "./en";

type EnKey = keyof typeof EN;
type PluralBase<K extends string> = K extends `${infer B}_one` ? B : never;
type ExtraPlural = `${PluralBase<EnKey>}_${"two" | "many"}`;

/**
 * Hebrew resource: same key set as EN plus `_two` / `_many` plural variants.
 * Values are English placeholders until task 07 translates them.
 */
export const HE: Record<EnKey | ExtraPlural, string> = {
  ...EN,
  diagnosticsCount_two: EN.diagnosticsCount_other,
  diagnosticsCount_many: EN.diagnosticsCount_other,
  importSummary_two: EN.importSummary_other,
  importSummary_many: EN.importSummary_other,
  importQueued_two: EN.importQueued_other,
  importQueued_many: EN.importQueued_other,
  deletedCount_two: EN.deletedCount_other,
  deletedCount_many: EN.deletedCount_other,
  deleteManyFailed_two: EN.deleteManyFailed_other,
  deleteManyFailed_many: EN.deleteManyFailed_other,
};
