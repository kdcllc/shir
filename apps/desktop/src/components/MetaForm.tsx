import { useId } from "react";
import type { FormEvent } from "react";
import type { EditMetaName } from "chord-core";
import { capoOptions } from "../library";
import { useT } from "../i18n";
import styles from "./MetaForm.module.css";
import { useDraft } from "./useDraft";

const MAX_CAPO = 24;

/** `values.capo` as a capo number, or `undefined` when it is not an integer in 0–24. */
function capoNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return undefined;
  const n = Number(trimmed);
  return n > MAX_CAPO ? undefined : n;
}

/** The five editable metadata values, each as its directive text (`""` when absent). */
export type MetaFormValues = { readonly [Name in EditMetaName]: string };

export interface MetaFormProps {
  values: MetaFormValues;
  onChange(name: EditMetaName, value: string): void;
}

const preventSubmit = (e: FormEvent) => e.preventDefault();

/** Song details: title, artist, key, capo and tempo. */
export function MetaForm({ values, onChange }: MetaFormProps) {
  const t = useT();
  const id = useId();
  const title = useDraft(values.title, (next) => onChange("title", next));
  const artist = useDraft(values.artist, (next) => onChange("artist", next));
  const key = useDraft(values.key, (next) => onChange("key", next));
  const tempo = useDraft(values.tempo, (next) => onChange("tempo", next));
  const capo = capoNumber(values.capo);
  const storedCapo = values.capo.trim();
  // Stored text that is not a capo number is shown as it is, so that choosing
  // any number (0 included) is a real change.
  const badCapo =
    capo === undefined && storedCapo !== "" ? storedCapo : undefined;

  return (
    <form
      className={styles.form}
      data-testid="meta-form"
      aria-label={t("metaForm")}
      data-ui-chrome
      onSubmit={preventSubmit}
    >
      <div className={`${styles.field} ${styles.wide}`}>
        <label htmlFor={`${id}-title`} className={styles.label}>
          {t("metaTitle")}
        </label>
        <input
          id={`${id}-title`}
          type="text"
          dir="auto"
          className={styles.input}
          data-testid="meta-title"
          {...title}
        />
      </div>
      <div className={`${styles.field} ${styles.wide}`}>
        <label htmlFor={`${id}-artist`} className={styles.label}>
          {t("metaArtist")}
        </label>
        <input
          id={`${id}-artist`}
          type="text"
          dir="auto"
          className={styles.input}
          data-testid="meta-artist"
          {...artist}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-key`} className={styles.label}>
          {t("key")}
        </label>
        <input
          id={`${id}-key`}
          type="text"
          dir="ltr"
          spellCheck={false}
          autoCapitalize="off"
          className={`${styles.input} ${styles.short}`}
          data-testid="meta-key"
          {...key}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-capo`} className={styles.label}>
          {t("capo")}
        </label>
        <select
          id={`${id}-capo`}
          className={styles.input}
          data-testid="meta-capo"
          value={badCapo ?? capo ?? 0}
          onChange={(e) =>
            onChange("capo", e.target.value === "0" ? "" : e.target.value)
          }
        >
          {badCapo !== undefined && <option value={badCapo}>{badCapo}</option>}
          {capoOptions(capo).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-tempo`} className={styles.label}>
          {t("metaTempo")}
        </label>
        <input
          id={`${id}-tempo`}
          type="text"
          inputMode="numeric"
          dir="ltr"
          className={`${styles.input} ${styles.short}`}
          data-testid="meta-tempo"
          {...tempo}
        />
      </div>
    </form>
  );
}
