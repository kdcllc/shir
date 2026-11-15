import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SongHeader } from "./SongHeader";

describe("SongHeader", () => {
  it("renders title, artist, key and capo", () => {
    render(
      <SongHeader title="Alpha" artist="Ann" soundingKey="F#m" capo={2} />,
    );
    expect(screen.getByTestId("song-header")).toBeInTheDocument();
    const title = screen.getByTestId("song-title");
    expect(title.tagName).toBe("H2");
    expect(title).toHaveAttribute("dir", "auto");
    expect(title.textContent).toBe("Alpha");
    expect(screen.getByTestId("song-artist").textContent).toBe("Ann");
    expect(screen.getByTestId("song-artist")).toHaveAttribute("dir", "auto");
    const key = screen.getByTestId("sounding-key");
    expect(key.textContent).toBe("F#m");
    const bdi = key.querySelector("bdi");
    expect(bdi).toHaveAttribute("dir", "ltr");
    expect(screen.getByText("Key")).toBeInTheDocument();
    expect(screen.getByText("Capo")).toBeInTheDocument();
    const capo = screen.getByTestId("capo-value");
    expect(capo.tagName).toBe("BDI");
    expect(capo).toHaveAttribute("dir", "ltr");
    expect(capo.textContent).toBe("2");
  });

  it("omits the artist when absent", () => {
    render(<SongHeader title="Alpha" soundingKey="C" capo={0} />);
    expect(screen.queryByTestId("song-artist")).toBeNull();
  });

  it("shows plain 'No key' text without bdi when there is no key", () => {
    render(<SongHeader title="Alpha" capo={0} />);
    const key = screen.getByTestId("sounding-key");
    expect(key.textContent).toBe("No key");
    expect(key.querySelector("bdi")).toBeNull();
  });

  it("omits the capo label and value when capo is 0", () => {
    render(<SongHeader title="Alpha" soundingKey="C" capo={0} />);
    expect(screen.queryByTestId("capo-value")).toBeNull();
    expect(screen.queryByText("Capo")).toBeNull();
  });

  it("renders a Hebrew title and artist with dir=auto", () => {
    render(<SongHeader title="שיר ראשון" artist="אמן" capo={0} />);
    expect(screen.getByTestId("song-title")).toHaveAttribute("dir", "auto");
    expect(screen.getByTestId("song-title").textContent).toBe("שיר ראשון");
    expect(screen.getByTestId("song-artist")).toHaveAttribute("dir", "auto");
    expect(screen.getByTestId("song-artist").textContent).toBe("אמן");
  });

  it("contains no inline style attributes", () => {
    const { container } = render(
      <SongHeader title="A" artist="B" soundingKey="C" capo={1} />,
    );
    expect(container.innerHTML).not.toContain("style=");
  });
});
