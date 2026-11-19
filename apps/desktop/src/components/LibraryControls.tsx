import type { KeyboardEvent } from "react";
import { useT } from "../i18n";
import type { LanguageFilter, SortOrder } from "../libraryView";
import styles from "./LibraryControls.module.css";

export interface LibraryControlsProps {
  sort: SortOrder;
  language: LanguageFilter;
  onSort(next: SortOrder): void;
  onLanguage(next: LanguageFilter): void;
}

const SORTS: readonly SortOrder[] = ["title", "artist", "updated"];
const LANGUAGES: readonly LanguageFilter[] = ["all", "he", "en", "mixed"];

function isSortOrder(v: string): v is SortOrder {
  return (SORTS as readonly string[]).includes(v);
}

/** Visual direction at `el`: the nearest `dir` attribute, else the document's. */
function isRtl(el: Element): boolean {
  const own = el.closest("[dir]")?.getAttribute("dir");
  const dir =
    own === "ltr" || own === "rtl" ? own : document.documentElement.dir;
  return dir === "rtl";
}

/** Sidebar controls: sort order and language filter (database mode). */
export function LibraryControls({
  sort,
  language,
  onSort,
  onLanguage,
}: LibraryControlsProps) {
  const t = useT();
  const labels = {
    all: t("filterAll"),
    he: t("filterHebrew"),
    en: t("filterEnglish"),
    mixed: t("filterMixed"),
  };
  const onKeyDown = (index: number) => (e: KeyboardEvent<HTMLElement>) => {
    const rtl = isRtl(e.currentTarget);
    let step: 1 | -1 | undefined;
    if (e.key === "ArrowDown") step = 1;
    else if (e.key === "ArrowUp") step = -1;
    else if (e.key === "ArrowRight") step = rtl ? -1 : 1;
    else if (e.key === "ArrowLeft") step = rtl ? 1 : -1;
    if (step === undefined) return;
    e.preventDefault();
    const to = (index + step + LANGUAGES.length) % LANGUAGES.length;
    const next = LANGUAGES[to];
    if (next === undefined) return;
    onLanguage(next);
    const radios =
      e.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
        '[role="radio"]',
      );
    radios?.[to]?.focus();
  };
  const radio = (value: LanguageFilter, index: number) => ({
    type: "button" as const,
    role: "radio" as const,
    className: styles.radio,
    "aria-checked": language === value,
    tabIndex: language === value ? 0 : -1,
    onClick: () => onLanguage(value),
    onKeyDown: onKeyDown(index),
  });
  return (
    <div
      className={styles.controls}
      role="group"
      aria-label={t("libraryView")}
      data-ui-chrome
    >
      <label className={styles.sort}>
        <span>{t("sortLabel")}</span>
        <select
          data-testid="library-sort"
          value={sort}
          onChange={(e) => {
            if (isSortOrder(e.target.value)) onSort(e.target.value);
          }}
        >
          <option value="title">{t("sortTitle")}</option>
          <option value="artist">{t("sortArtist")}</option>
          <option value="updated">{t("sortUpdated")}</option>
        </select>
      </label>
      <div
        className={styles.filter}
        role="radiogroup"
        aria-label={t("filterLanguage")}
      >
        <button data-testid="library-filter-all" {...radio("all", 0)}>
          {labels.all}
        </button>
        <button data-testid="library-filter-he" {...radio("he", 1)}>
          {labels.he}
        </button>
        <button data-testid="library-filter-en" {...radio("en", 2)}>
          {labels.en}
        </button>
        <button data-testid="library-filter-mixed" {...radio("mixed", 3)}>
          {labels.mixed}
        </button>
      </div>
    </div>
  );
}
