import type { KeyboardEvent } from "react";
import { useT } from "../i18n";
import styles from "./SidebarTabs.module.css";

export type SidebarView = "songs" | "setlists";

export interface SidebarTabsProps {
  view: SidebarView;
  onChange(view: SidebarView): void;
}

const VIEWS: readonly SidebarView[] = ["songs", "setlists"];

/** Writing direction of the tab strip: the nearest `dir` attribute (`auto` counts as LTR). */
function isRtl(el: HTMLElement): boolean {
  const dir =
    el.closest("[dir]")?.getAttribute("dir") ??
    document.documentElement.getAttribute("dir");
  return dir === "rtl";
}

/** Songs / Setlists switch of the sidebar. Arrow keys follow the visual order. */
export function SidebarTabs({ view, onChange }: SidebarTabsProps) {
  const t = useT();
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = VIEWS.indexOf(view);
    let next: number;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = VIEWS.length - 1;
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const forward = (e.key === "ArrowRight") !== isRtl(e.currentTarget);
      next = Math.min(
        VIEWS.length - 1,
        Math.max(0, index + (forward ? 1 : -1)),
      );
    } else return;
    e.preventDefault();
    const target = VIEWS[next]!;
    const buttons =
      e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]');
    buttons[next]?.focus();
    if (target !== view) onChange(target);
  };

  const tabProps = (v: SidebarView) => ({
    type: "button" as const,
    role: "tab",
    "aria-selected": view === v,
    tabIndex: view === v ? 0 : -1,
    className: styles.tab,
    onClick: () => onChange(v),
  });

  return (
    <div
      role="tablist"
      aria-label={t("sidebarViews")}
      className={styles.tabs}
      data-testid="sidebar-tabs"
      data-ui-chrome
      onKeyDown={onKeyDown}
    >
      <button {...tabProps("songs")} data-testid="tab-songs">
        {t("tabSongs")}
      </button>
      <button {...tabProps("setlists")} data-testid="tab-setlists">
        {t("tabSetlists")}
      </button>
    </div>
  );
}
