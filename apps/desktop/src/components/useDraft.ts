import { useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";

const noSent = (): string | undefined => undefined;

/**
 * Local draft of a text value: typing stays local, blur and Enter commit the
 * trimmed draft once when it differs from `value`, Escape restores `value`,
 * and an outside change of `value` replaces the draft.
 */
export function useDraft(value: string, commit: (next: string) => void) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  const [sent, setSent] = useState(noSent);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
    setSent(undefined);
  }

  const flush = () => {
    const next = draft.trim();
    if (next === value || next === sent) return;
    setSent(next);
    commit(next);
  };

  return {
    value: draft,
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      setDraft(e.target.value);
      setSent(undefined);
    },
    onBlur: flush,
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        flush();
      } else if (e.key === "Escape") {
        setDraft(value);
        setSent(undefined);
      }
    },
  };
}
