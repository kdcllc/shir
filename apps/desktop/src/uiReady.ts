import { isTauri } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

/** Event the Rust launch smoke waits for before printing SHIR_READY. */
export const UI_READY_EVENT = "shir://ui-ready";

let signalled = false;

/** Tell the Tauri shell that React mounted. No-op outside Tauri; at most once per page load; never throws. */
export async function signalUiReady(): Promise<void> {
  if (!isTauri() || signalled) return;
  signalled = true;
  try {
    await emit(UI_READY_EVENT);
  } catch (error) {
    console.error("Failed to signal UI ready", error);
  }
}
