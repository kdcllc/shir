import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { STRINGS } from "../strings";
import { SIDEBAR_PANEL_IDS, SIDEBAR_TAB_IDS, SidebarTabs } from "./SidebarTabs";

function setup(view: "songs" | "setlists", dir?: "rtl" | "ltr") {
  const onChange = vi.fn();
  render(
    <div dir={dir}>
      <SidebarTabs view={view} onChange={onChange} />
    </div>,
  );
  return { onChange };
}

const songs = () => screen.getByTestId("tab-songs");
const setlists = () => screen.getByTestId("tab-setlists");

describe("SidebarTabs", () => {
  it("is a tablist with a Songs and a Setlists tab", () => {
    setup("songs");
    const list = screen.getByRole("tablist");
    expect(list).toHaveAttribute("data-ui-chrome");
    expect(list).toHaveAccessibleName(STRINGS.sidebarViews);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      STRINGS.tabSongs,
      STRINGS.tabSetlists,
    ]);
  });

  it("marks the current view selected and only it tabbable", () => {
    setup("setlists");
    expect(songs()).toHaveAttribute("aria-selected", "false");
    expect(setlists()).toHaveAttribute("aria-selected", "true");
    expect(songs()).toHaveAttribute("tabindex", "-1");
    expect(setlists()).toHaveAttribute("tabindex", "0");
  });

  it("gives the tabs ids and points aria-controls from the selected tab only", () => {
    expect(SIDEBAR_TAB_IDS).toEqual({
      songs: "sidebar-tab-songs",
      setlists: "sidebar-tab-setlists",
    });
    expect(SIDEBAR_PANEL_IDS).toEqual({
      songs: "sidebar-panel-songs",
      setlists: "sidebar-panel-setlists",
    });
    const view = render(<SidebarTabs view="songs" onChange={vi.fn()} />);
    expect(songs()).toHaveAttribute("id", SIDEBAR_TAB_IDS.songs);
    expect(setlists()).toHaveAttribute("id", SIDEBAR_TAB_IDS.setlists);
    expect(songs()).toHaveAttribute("aria-controls", SIDEBAR_PANEL_IDS.songs);
    expect(setlists()).not.toHaveAttribute("aria-controls");
    view.rerender(<SidebarTabs view="setlists" onChange={vi.fn()} />);
    expect(songs()).not.toHaveAttribute("aria-controls");
    expect(setlists()).toHaveAttribute(
      "aria-controls",
      SIDEBAR_PANEL_IDS.setlists,
    );
  });

  it("a click selects that view", () => {
    const { onChange } = setup("songs");
    fireEvent.click(setlists());
    expect(onChange).toHaveBeenCalledWith("setlists");
  });

  it("in LTR ArrowRight selects the next tab, ArrowLeft the previous", () => {
    const { onChange } = setup("songs", "ltr");
    songs().focus();
    fireEvent.keyDown(songs(), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("setlists");
    expect(setlists()).toHaveFocus();
  });

  it("in LTR ArrowLeft goes to the previous tab", () => {
    const { onChange } = setup("setlists", "ltr");
    fireEvent.keyDown(setlists(), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("songs");
    expect(songs()).toHaveFocus();
  });

  it("in RTL ArrowLeft goes to the next tab and ArrowRight to the previous", () => {
    const first = setup("songs", "rtl");
    fireEvent.keyDown(songs(), { key: "ArrowLeft" });
    expect(first.onChange).toHaveBeenLastCalledWith("setlists");
    expect(setlists()).toHaveFocus();
  });

  it("in RTL ArrowRight goes to the previous tab", () => {
    const { onChange } = setup("setlists", "rtl");
    fireEvent.keyDown(setlists(), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("songs");
    expect(songs()).toHaveFocus();
  });

  it("in RTL ArrowRight on the first tab stays put (no wrap, no call)", () => {
    const { onChange } = setup("songs", "rtl");
    fireEvent.keyDown(songs(), { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reads the direction from the document when no ancestor sets dir", () => {
    document.documentElement.dir = "rtl";
    const { onChange } = setup("songs");
    fireEvent.keyDown(songs(), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("setlists");
  });

  it("Home and End jump to the ends", () => {
    const { onChange } = setup("songs", "ltr");
    fireEvent.keyDown(songs(), { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("setlists");
    onChange.mockClear();
    render(
      <div>
        <SidebarTabs view="setlists" onChange={onChange} />
      </div>,
    );
    fireEvent.keyDown(screen.getAllByTestId("tab-setlists")[1]!, {
      key: "Home",
    });
    expect(onChange).toHaveBeenLastCalledWith("songs");
  });

  it("ignores other keys", () => {
    const { onChange } = setup("songs");
    fireEvent.keyDown(songs(), { key: "a" });
    expect(onChange).not.toHaveBeenCalled();
  });
});
