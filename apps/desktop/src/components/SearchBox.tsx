import type { KeyboardEvent } from "react";
import { STRINGS } from "../strings";
import styles from "./SearchBox.module.css";

export interface SearchBoxProps {
  value: string;
  disabled?: boolean;
  onChange(next: string): void;
}

export function SearchBox({ value, disabled, onChange }: SearchBoxProps) {
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
      aria-label={STRINGS.searchLabel}
      placeholder={STRINGS.searchPlaceholder}
      value={value}
      disabled={disabled === true}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}
