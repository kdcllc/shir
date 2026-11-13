import styles from "./ChordSymbol.module.css";

/** Chord symbols are LTR-isolated so they never reorder inside RTL lyrics (B1). */
export function ChordSymbol({ chord }: { chord: string }) {
  return (
    <bdi dir="ltr" className={`chord ${styles.chord}`} data-chord={chord}>
      {chord}
    </bdi>
  );
}
