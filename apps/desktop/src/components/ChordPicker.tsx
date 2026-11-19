import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { useT } from "../i18n";
import styles from "./ChordPicker.module.css";

const noInput = (): HTMLInputElement | null => null;

/** Highlight index when no option is highlighted. */
const NONE = -1;

export interface ChordPickerProps {
  /** Chord text when editing an existing chord; default "" (adding). */
  initial?: string | undefined;
  /** Suggestions for the trimmed typed text as prefix, best first. */
  suggestions(prefix: string): readonly string[];
  /** Whether the trimmed text may be applied (e.g. chord-core `isValidChordText`). */
  isValid(chord: string): boolean;
  /** Whether the trimmed text is a recognized chord (e.g. `parseChord(chord) !== null`). */
  isKnown(chord: string): boolean;
  onSubmit(chord: string): void;
  /** Present only when editing an existing chord. */
  onRemove?: (() => void) | undefined;
  /** Present only when editing an existing chord: move one position to the visual left / right. */
  onMove?: ((side: "left" | "right") => void) | undefined;
  onClose(): void;
}

/**
 * Non-modal chord picker: a combobox with suggestions. It neither traps focus
 * nor closes itself; the host decides what a submit or close does.
 */
export function ChordPicker({
  initial,
  suggestions,
  isValid,
  isKnown,
  onSubmit,
  onRemove,
  onMove,
  onClose,
}: ChordPickerProps) {
  const t = useT();
  const listId = useId();
  const input = useRef(noInput());
  const [text, setText] = useState(initial ?? "");
  const [active, setActive] = useState(NONE);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const chord = text.trim();
  const options = suggestions(chord);
  const valid = isValid(chord);
  const unknown = valid && !isKnown(chord);
  const highlighted = active === NONE ? undefined : options[active];
  const activeId =
    highlighted === undefined ? undefined : `${listId}-${active}`;

  const step = (delta: 1 | -1) => {
    const count = options.length;
    if (count === 0) return;
    if (highlighted === undefined) setActive(delta === 1 ? 0 : count - 1);
    else setActive((active + delta + count) % count);
  };

  const apply = () => {
    if (valid) onSubmit(chord);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlighted === undefined) apply();
      else onSubmit(highlighted.trim());
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  // Keeps the caret in the input when an option is clicked.
  const keepFocus = (e: MouseEvent<HTMLLIElement>) => e.preventDefault();

  return (
    <div
      role="dialog"
      aria-label={t("chordPicker")}
      className={styles.picker}
      data-testid="chord-picker"
      data-ui-chrome
    >
      <div className={styles.entry}>
        <input
          ref={input}
          type="text"
          role="combobox"
          dir="ltr"
          className={styles.input}
          data-testid="chord-input"
          aria-label={t("chordInput")}
          aria-autocomplete="list"
          aria-expanded={options.length !== 0}
          aria-controls={listId}
          aria-activedescendant={activeId}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(NONE);
          }}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          data-testid="chord-apply"
          disabled={!valid}
          onClick={apply}
        >
          {t("chordApply")}
        </button>
      </div>
      <p role="status" className={styles.warning} data-testid="chord-warning">
        {unknown ? t("chordUnknown") : ""}
      </p>
      <ul
        id={listId}
        role="listbox"
        aria-label={t("chordSuggestions")}
        className={styles.options}
      >
        {options.map((option, i) => (
          <li
            key={`${i}:${option}`}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            className={styles.option}
            data-testid="chord-option"
            onMouseDown={keepFocus}
            onClick={() => onSubmit(option.trim())}
          >
            <bdi dir="ltr">{option}</bdi>
          </li>
        ))}
      </ul>
      <div className={styles.actions}>
        {onMove !== undefined && (
          <span dir="ltr" className={styles.moves}>
            <button
              type="button"
              data-testid="chord-move-left"
              aria-label={t("chordMoveLeft")}
              onClick={() => onMove("left")}
            >
              {t("leftGlyph")}
            </button>
            <button
              type="button"
              data-testid="chord-move-right"
              aria-label={t("chordMoveRight")}
              onClick={() => onMove("right")}
            >
              {t("rightGlyph")}
            </button>
          </span>
        )}
        {onRemove !== undefined && (
          <button type="button" data-testid="chord-remove" onClick={onRemove}>
            {t("chordRemove")}
          </button>
        )}
        <button
          type="button"
          className={styles.close}
          data-testid="chord-close"
          onClick={onClose}
        >
          {t("chordClose")}
        </button>
      </div>
    </div>
  );
}
