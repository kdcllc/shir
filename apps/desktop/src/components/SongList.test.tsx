import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { parseSong } from "chord-core";
import type { LibrarySong, SongGroup } from "../library";
import { SongList } from "./SongList";

function entry(
  group: SongGroup,
  base: string,
  title: string,
  artist?: string,
): LibrarySong {
  const { song, diagnostics } = parseSong(`{title: ${title}}\n`);
  const result: LibrarySong = {
    id: `${group}:${base}`,
    group,
    fileName: `${base}.cho`,
    title,
    song,
    diagnostics,
  };
  if (artist !== undefined) result.artist = artist;
  return result;
}

const songs = [
  entry("samples", "a", "Alpha", "Ann"),
  entry("test-songs", "b", "Beta"),
  entry("samples", "c", "Gamma"),
];

describe("SongList", () => {
  it("renders a labelled nav with one button per song", () => {
    render(
      <SongList songs={songs} selectedId={undefined} onSelect={vi.fn()} />,
    );
    const nav = screen.getByTestId("song-list");
    expect(nav.tagName).toBe("NAV");
    expect(nav).toHaveAttribute("aria-label", "Songs");
    expect(nav).toHaveAttribute("data-ui-chrome");
    const items = screen.getAllByTestId("song-item");
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.tagName).toBe("BUTTON");
      expect(item).toHaveAttribute("type", "button");
    }
  });

  it("groups songs in SongGroup order with group labels", () => {
    render(
      <SongList
        songs={[songs[1]!, songs[0]!, songs[2]!]}
        selectedId={undefined}
        onSelect={vi.fn()}
      />,
    );
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings).toEqual(["Samples", "Test songs"]);
    const lists = screen.getAllByRole("list");
    expect(
      within(lists[0]!)
        .getAllByTestId("song-item")
        .map((b) => b.textContent),
    ).toEqual(["AlphaAnn", "Gamma"]);
    expect(
      within(lists[1]!)
        .getAllByTestId("song-item")
        .map((b) => b.textContent),
    ).toEqual(["Beta"]);
  });

  it("omits empty groups", () => {
    render(
      <SongList
        songs={[songs[1]!]}
        selectedId={undefined}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual([
      "Test songs",
    ]);
  });

  it("marks only the selected song with aria-current", () => {
    render(
      <SongList songs={songs} selectedId="samples:c" onSelect={vi.fn()} />,
    );
    const items = screen.getAllByTestId("song-item");
    const current = items.filter((b) => b.hasAttribute("aria-current"));
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("aria-current", "true");
    expect(current[0]!.textContent).toBe("Gamma");
  });

  it("calls onSelect with the id on click", () => {
    const onSelect = vi.fn();
    render(
      <SongList songs={songs} selectedId={undefined} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByText("Beta"));
    expect(onSelect).toHaveBeenCalledWith("test-songs:b");
  });

  it("shows Hebrew title and artist with dir=auto, artist only when present", () => {
    render(
      <SongList
        songs={[entry("samples", "h", "שיר ראשון", "אמן"), songs[2]!]}
        selectedId={undefined}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("שיר ראשון")).toHaveAttribute("dir", "auto");
    expect(screen.getByText("אמן")).toHaveAttribute("dir", "auto");
    const gamma = screen.getByText("Gamma").closest("button")!;
    expect(gamma.querySelectorAll("[dir]")).toHaveLength(1);
  });

  it("contains no inline style attributes", () => {
    const { container } = render(
      <SongList songs={songs} selectedId="samples:a" onSelect={vi.fn()} />,
    );
    expect(container.innerHTML).not.toContain("style=");
  });
});
