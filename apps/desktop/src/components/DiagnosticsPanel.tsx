import type { Diagnostic } from "chord-core";
import { useT } from "../i18n";
import styles from "./DiagnosticsPanel.module.css";

export interface DiagnosticsPanelProps {
  diagnostics: readonly Diagnostic[];
}

export function DiagnosticsPanel({ diagnostics }: DiagnosticsPanelProps) {
  const t = useT();
  if (diagnostics.length === 0) return null;
  return (
    <section data-testid="diagnostics" data-ui-chrome className={styles.panel}>
      <h3 className={styles.heading}>
        {t("diagnostics")} {t("separator")}{" "}
        {t("diagnosticsCount", { count: diagnostics.length })}
      </h3>
      <ul className={styles.items}>
        {diagnostics.map((d, i) => (
          <li key={i} data-testid="diagnostic-item" className={styles.item}>
            <bdi dir="ltr">
              {d.line}:{d.column}
            </bdi>{" "}
            <span dir="auto">{d.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
