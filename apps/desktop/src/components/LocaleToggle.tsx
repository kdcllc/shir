import { useLocale, useT } from "../i18n";
import type { Locale } from "../i18n/locale";
import styles from "./LocaleToggle.module.css";

/** Interface-language switch: two buttons, the current one pressed. */
export function LocaleToggle() {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const choose = (next: Locale) => {
    if (next !== locale) setLocale(next);
  };
  return (
    <div
      role="group"
      aria-label={t("uiLanguage")}
      className={styles.toggle}
      data-testid="locale-toggle"
      data-ui-chrome
    >
      <button
        type="button"
        lang="he"
        className={styles.button}
        data-testid="locale-he"
        aria-label={t("localeHebrew")}
        aria-pressed={locale === "he"}
        onClick={() => choose("he")}
      >
        {t("localeHebrewShort")}
      </button>
      <button
        type="button"
        lang="en"
        className={styles.button}
        data-testid="locale-en"
        aria-label={t("localeEnglish")}
        aria-pressed={locale === "en"}
        onClick={() => choose("en")}
      >
        {t("localeEnglishShort")}
      </button>
    </div>
  );
}
