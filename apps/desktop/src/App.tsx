import { useEffect } from "react";
import { ChordSymbol } from "chord-render";
import styles from "./App.module.css";
import { signalUiReady } from "./uiReady";

export function App() {
  useEffect(() => {
    void signalUiReady();
  }, []);

  return (
    <main className={styles.shell}>
      <h1>
        Shir · <bdi lang="he">שיר</bdi>
      </h1>
      <p data-testid="chord-demo">
        <ChordSymbol chord="F#m7(b5)" />
      </p>
    </main>
  );
}
