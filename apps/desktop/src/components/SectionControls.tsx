import { SECTION_KINDS } from "chord-core";
import type { SectionKind } from "chord-core";
import { useT } from "../i18n";
import styles from "./SectionControls.module.css";
import { useDraft } from "./useDraft";

const KIND_LABEL_KEYS = {
  verse: "sectionVerse",
  chorus: "sectionChorus",
  bridge: "sectionBridge",
} as const satisfies { readonly [Kind in SectionKind]: string };

/** `value` as a section kind the editor can rename to, else `undefined`. */
function kindOf(value: string): SectionKind | undefined {
  return SECTION_KINDS.find((kind) => kind === value);
}

export interface SectionControlsProps {
  section: string;
  label?: string | undefined;
  /** Literal sections (tab, grid, …) cannot be renamed. */
  literal: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onRename(section: SectionKind, label: string): void;
  onMove(direction: "up" | "down"): void;
  onRemove(): void;
}

/** Header controls of one section: type, label, reorder and remove. */
export function SectionControls({
  section,
  label,
  literal,
  canMoveUp,
  canMoveDown,
  onRename,
  onMove,
  onRemove,
}: SectionControlsProps) {
  const t = useT();
  const kind = kindOf(section);
  const draft = useDraft(label ?? "", (next) => {
    if (kind !== undefined) onRename(kind, next);
  });
  const kindLabel =
    kind === undefined ? t("sectionOther") : t(KIND_LABEL_KEYS[kind]);
  const ownLabel = (label ?? "").trim();
  const groupName = ownLabel === "" ? kindLabel : `${kindLabel} ${ownLabel}`;

  return (
    <div
      role="group"
      aria-label={groupName}
      className={styles.controls}
      data-ui-chrome
    >
      <select
        className={styles.kind}
        data-testid="section-kind"
        aria-label={t("sectionKind")}
        value={kind ?? ""}
        disabled={literal}
        onChange={(e) => {
          const next = kindOf(e.target.value);
          if (next !== undefined) onRename(next, draft.value.trim());
        }}
      >
        {kind === undefined && <option value="">{t("sectionOther")}</option>}
        {SECTION_KINDS.map((option) => (
          <option key={option} value={option}>
            {t(KIND_LABEL_KEYS[option])}
          </option>
        ))}
      </select>
      <input
        type="text"
        dir="auto"
        className={styles.label}
        data-testid="section-label"
        aria-label={t("sectionLabel")}
        placeholder={t("noLabel")}
        disabled={literal || kind === undefined}
        {...draft}
      />
      <span className={styles.buttons}>
        <button
          type="button"
          data-testid="section-up"
          aria-label={t("sectionUp")}
          disabled={!canMoveUp}
          onClick={() => onMove("up")}
        >
          {t("upGlyph")}
        </button>
        <button
          type="button"
          data-testid="section-down"
          aria-label={t("sectionDown")}
          disabled={!canMoveDown}
          onClick={() => onMove("down")}
        >
          {t("downGlyph")}
        </button>
        <button
          type="button"
          data-testid="section-remove"
          aria-label={t("sectionRemove")}
          onClick={onRemove}
        >
          {t("removeGlyph")}
        </button>
      </span>
    </div>
  );
}
