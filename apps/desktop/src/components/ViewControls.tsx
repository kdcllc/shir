import { useId } from "react";
import { useT } from "../i18n";
import styles from "./ViewControls.module.css";

export interface ViewControlsProps {
  transpose: number;
  capo: number;
  capoOptions: readonly number[];
  shapeKey?: string;
  onTranspose(next: number): void;
  onCapo(next: number): void;
  onReset(): void;
}

const MAX_TRANSPOSE = 11;

function formatTranspose(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export function ViewControls({
  transpose,
  capo,
  capoOptions,
  shapeKey,
  onTranspose,
  onCapo,
  onReset,
}: ViewControlsProps) {
  const t = useT();
  const capoId = useId();
  return (
    <div data-ui-chrome className={styles.controls}>
      <div className={styles.group}>
        <span className={styles.label}>{t("transpose")}</span>
        <button
          type="button"
          data-testid="transpose-down"
          aria-label={t("transposeDown")}
          disabled={transpose <= -MAX_TRANSPOSE}
          onClick={() => {
            if (transpose > -MAX_TRANSPOSE)
              onTranspose(Math.min(MAX_TRANSPOSE, transpose - 1));
          }}
        >
          {t("transposeDownGlyph")}
        </button>
        <bdi dir="ltr" data-testid="transpose-value" className={styles.value}>
          {formatTranspose(transpose)}
        </bdi>
        <button
          type="button"
          data-testid="transpose-up"
          aria-label={t("transposeUp")}
          disabled={transpose >= MAX_TRANSPOSE}
          onClick={() => {
            if (transpose < MAX_TRANSPOSE)
              onTranspose(Math.max(-MAX_TRANSPOSE, transpose + 1));
          }}
        >
          {t("transposeUpGlyph")}
        </button>
      </div>
      <div className={styles.group}>
        <label htmlFor={capoId} className={styles.label}>
          {t("capo")}
        </label>
        <select
          id={capoId}
          data-testid="capo-select"
          value={capo}
          onChange={(e) => onCapo(Number(e.target.value))}
        >
          {capoOptions.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      {shapeKey !== undefined && (
        <div className={styles.group}>
          <span className={styles.label}>{t("shapes")}</span>
          <bdi dir="ltr" data-testid="shape-key">
            {shapeKey}
          </bdi>
        </div>
      )}
      <button type="button" data-testid="reset-view" onClick={onReset}>
        {t("reset")}
      </button>
    </div>
  );
}
