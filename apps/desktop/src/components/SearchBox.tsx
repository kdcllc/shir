import type { KeyboardEvent } from "react";
import { useT } from "../i18n";
import styles from "./SearchBox.module.css";

export interface SearchBoxProps {
  value: string;
  disabled?: boolean;
  onChange(next: string): void;
}

export function SearchBox({ value, disabled, onChange }: SearchBoxProps) {
  const t = useT();
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onChange("");
    }
  };
  return (
    <input
      type="search"
      dir="auto"
      className={styles.input}
      data-testid="search-input"
      data-ui-chrome
      aria-label={t("searchLabel")}
      placeholder={t("searchPlaceholder")}
      value={value}
      disabled={disabled === true}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}
