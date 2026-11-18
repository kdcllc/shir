import { parseSong } from "chord-core";
import { SongView } from "chord-render";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { EditingSong, type HarnessEdit } from "./EditingSong";

declare global {
  interface Window {
    __setWidth?: (px: number) => void;
    __lastEdit?: HarnessEdit;
  }
}

const params = new URLSearchParams(window.location.search);
if (params.get("nofonts") !== "1") {
  await import("../src/fonts.css");
}

const sources = import.meta.glob("../../test-fixtures/fixtures/*.cho", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function source(name: string | null): string | undefined {
  if (!name) return undefined;
  const key = Object.keys(sources).find((k) => k.endsWith(`/${name}.cho`));
  return key ? sources[key] : undefined;
}

function mount() {
  const host = document.getElementById("root");
  if (!host) return;
  const name = params.get("fixture");
  const src = source(name);
  if (src === undefined) {
    host.innerHTML = "";
    const p = document.createElement("p");
    p.setAttribute("data-harness-error", "");
    p.textContent = name
      ? `Unknown fixture: ${name}`
      : "Missing required fixture parameter";
    host.append(p);
    document.body.dataset.ready = "1";
    return;
  }
  const width = Number(params.get("width") ?? "720");
  const widthPx = Number.isFinite(width) && width > 0 ? width : 720;
  const model = parseSong(src).song;
  const editing = params.get("editing") === "1";

  flushSync(() => {
    createRoot(host).render(
      <>
        <nav data-ui-chrome="">Shir harness chrome</nav>
        <main data-harness="" style={{ inlineSize: `${widthPx}px` }}>
          {editing ? <EditingSong song={model} /> : <SongView song={model} />}
        </main>
      </>,
    );
  });

  const main = host.querySelector<HTMLElement>("[data-harness]");
  window.__setWidth = (px: number) => {
    if (main) main.style.inlineSize = `${px}px`;
  };

  const song = host.querySelector<HTMLElement>("[data-song]");
  const pass = () => Number(song?.getAttribute("data-overlap-pass") ?? "0");
  void document.fonts.ready.then(() => {
    const atReady = pass();
    const done = () => {
      document.body.dataset.ready = "1";
    };
    if (!song || pass() > atReady) {
      done();
      return;
    }
    const mo = new MutationObserver(() => {
      if (pass() > atReady) {
        mo.disconnect();
        done();
      }
    });
    mo.observe(song, {
      attributes: true,
      attributeFilter: ["data-overlap-pass"],
    });
  });
}

mount();
