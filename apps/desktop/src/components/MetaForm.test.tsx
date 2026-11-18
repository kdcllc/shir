import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { STRINGS } from "../strings";
import { MetaForm } from "./MetaForm";
import type { MetaFormValues } from "./MetaForm";

const EMPTY: MetaFormValues = {
  title: "",
  artist: "",
  key: "",
  capo: "",
  tempo: "",
};

function setup(values: Partial<MetaFormValues> = {}) {
  const onChange = vi.fn();
  const view = render(
    <MetaForm values={{ ...EMPTY, ...values }} onChange={onChange} />,
  );
  const update = (next: Partial<MetaFormValues>) =>
    view.rerender(
      <MetaForm values={{ ...EMPTY, ...next }} onChange={onChange} />,
    );
  return { onChange, update, ...view };
}

const field = (id: string) => screen.getByTestId<HTMLInputElement>(id);
const type = (id: string, value: string) =>
  fireEvent.change(field(id), { target: { value } });
const capoChoices = () =>
  Array.from(field("meta-capo").querySelectorAll("option")).map(
    (o) => o.textContent,
  );

describe("MetaForm", () => {
  it("is a labelled form that is print-hidden chrome", () => {
    setup();
    const form = screen.getByTestId("meta-form");
    expect(form.tagName).toBe("FORM");
    expect(form).toHaveAccessibleName(STRINGS.metaForm);
    expect(form).toHaveAttribute("data-ui-chrome");
  });

  it("labels every control from STRINGS", () => {
    setup();
    expect(screen.getByLabelText(STRINGS.metaTitle)).toBe(field("meta-title"));
    expect(screen.getByLabelText(STRINGS.metaArtist)).toBe(
      field("meta-artist"),
    );
    expect(screen.getByLabelText(STRINGS.key)).toBe(field("meta-key"));
    expect(screen.getByLabelText(STRINGS.capo)).toBe(field("meta-capo"));
    expect(screen.getByLabelText(STRINGS.metaTempo)).toBe(field("meta-tempo"));
  });

  it("sets each control's direction and input hints", () => {
    setup();
    expect(field("meta-title")).toHaveAttribute("dir", "auto");
    expect(field("meta-title")).toHaveAttribute("type", "text");
    expect(field("meta-artist")).toHaveAttribute("dir", "auto");
    expect(field("meta-key")).toHaveAttribute("dir", "ltr");
    expect(field("meta-key")).toHaveAttribute("spellcheck", "false");
    expect(field("meta-tempo")).toHaveAttribute("dir", "ltr");
    expect(field("meta-tempo")).toHaveAttribute("inputmode", "numeric");
    expect(field("meta-tempo")).toHaveAttribute("type", "text");
    expect(field("meta-capo").tagName).toBe("SELECT");
  });

  it("shows the given values", () => {
    setup({ title: "Song", artist: "Band", key: "Am", capo: "3", tempo: "96" });
    expect(field("meta-title")).toHaveValue("Song");
    expect(field("meta-artist")).toHaveValue("Band");
    expect(field("meta-key")).toHaveValue("Am");
    expect(field("meta-capo")).toHaveValue("3");
    expect(field("meta-tempo")).toHaveValue("96");
  });

  it("typing keeps a local draft and does not call onChange", () => {
    const { onChange } = setup({ title: "Old" });
    type("meta-title", "New");
    expect(field("meta-title")).toHaveValue("New");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("blur commits the trimmed draft once", () => {
    const { onChange } = setup({ title: "Old" });
    type("meta-title", "  New title ");
    fireEvent.blur(field("meta-title"));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("title", "New title");
  });

  it("Enter commits the trimmed draft once, and a following blur adds nothing", () => {
    const { onChange } = setup();
    type("meta-artist", " Band ");
    fireEvent.keyDown(field("meta-artist"), { key: "Enter" });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("artist", "Band");
    fireEvent.blur(field("meta-artist"));
    fireEvent.keyDown(field("meta-artist"), { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("commits each text field under its own name", () => {
    const { onChange } = setup();
    type("meta-key", "F#m");
    fireEvent.blur(field("meta-key"));
    type("meta-tempo", "120");
    fireEvent.keyDown(field("meta-tempo"), { key: "Enter" });
    expect(onChange.mock.calls).toEqual([
      ["key", "F#m"],
      ["tempo", "120"],
    ]);
  });

  it("does not call onChange when the trimmed draft equals the value", () => {
    const { onChange } = setup({ title: "Same" });
    fireEvent.blur(field("meta-title"));
    fireEvent.keyDown(field("meta-title"), { key: "Enter" });
    type("meta-title", "  Same  ");
    fireEvent.blur(field("meta-title"));
    fireEvent.keyDown(field("meta-title"), { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clearing a field commits the empty string", () => {
    const { onChange } = setup({ tempo: "96" });
    type("meta-tempo", "   ");
    fireEvent.blur(field("meta-tempo"));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("tempo", "");
  });

  it("commits again after the draft is edited again", () => {
    const { onChange } = setup();
    type("meta-title", "One");
    fireEvent.blur(field("meta-title"));
    type("meta-title", "Two");
    fireEvent.blur(field("meta-title"));
    type("meta-title", "One");
    fireEvent.blur(field("meta-title"));
    expect(onChange.mock.calls).toEqual([
      ["title", "One"],
      ["title", "Two"],
      ["title", "One"],
    ]);
  });

  it("Escape restores the draft to the value without committing", () => {
    const { onChange } = setup({ title: "Kept" });
    type("meta-title", "Thrown away");
    fireEvent.keyDown(field("meta-title"), { key: "Escape" });
    expect(field("meta-title")).toHaveValue("Kept");
    fireEvent.blur(field("meta-title"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("the draft follows a value changed from outside", () => {
    const { onChange, update } = setup({ title: "First", key: "C" });
    type("meta-title", "Half typed");
    update({ title: "Undone", key: "D" });
    expect(field("meta-title")).toHaveValue("Undone");
    expect(field("meta-key")).toHaveValue("D");
    fireEvent.blur(field("meta-title"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("an outside change of another field leaves a draft alone", () => {
    const { update } = setup({ title: "First", key: "C" });
    type("meta-title", "Half typed");
    update({ title: "First", key: "D" });
    expect(field("meta-title")).toHaveValue("Half typed");
  });

  it("commits a Hebrew title and artist unchanged", () => {
    const { onChange } = setup();
    const title = "שִׁיר חָדָשׁ";
    type("meta-title", title);
    fireEvent.blur(field("meta-title"));
    type("meta-artist", "להקת rock הבית");
    fireEvent.keyDown(field("meta-artist"), { key: "Enter" });
    expect(onChange.mock.calls).toEqual([
      ["title", title],
      ["artist", "להקת rock הבית"],
    ]);
    expect(field("meta-title")).toHaveAttribute("dir", "auto");
    expect(field("meta-artist")).toHaveAttribute("dir", "auto");
  });

  it("the form never submits", () => {
    setup();
    const allowed = fireEvent.submit(screen.getByTestId("meta-form"));
    expect(allowed).toBe(false);
  });

  it("offers capo 0 to 12, shown as numbers", () => {
    setup();
    expect(capoChoices()).toEqual(Array.from({ length: 13 }, (_, i) => `${i}`));
    expect(field("meta-capo")).toHaveValue("0");
  });

  it("appends the song's own capo when it is above 12", () => {
    setup({ capo: "15" });
    expect(capoChoices().at(-1)).toBe("15");
    expect(capoChoices()).toHaveLength(14);
    expect(field("meta-capo")).toHaveValue("15");
  });

  it("choosing a capo sends the number as a string at once", () => {
    const { onChange } = setup();
    fireEvent.change(field("meta-capo"), { target: { value: "3" } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("capo", "3");
  });

  it("choosing capo 0 sends the empty string", () => {
    const { onChange } = setup({ capo: "5" });
    expect(field("meta-capo")).toHaveValue("5");
    fireEvent.change(field("meta-capo"), { target: { value: "0" } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("capo", "");
  });

  it.each(["", "   "])("shows capo 0 for the value %j", (capo) => {
    setup({ capo });
    expect(field("meta-capo")).toHaveValue("0");
    expect(capoChoices()).toHaveLength(13);
  });

  it.each([
    ["abc", "abc"],
    ["2.5", "2.5"],
    ["-1", "-1"],
    ["25", "25"],
    ["100", "100"],
    [" x7 ", "x7"],
  ])("shows the stored text for the capo value %j", (capo, shown) => {
    setup({ capo });
    expect(field("meta-capo")).toHaveValue(shown);
    expect(capoChoices()).toEqual([
      shown,
      ...Array.from({ length: 13 }, (_, i) => `${i}`),
    ]);
    const first = field("meta-capo").querySelector("option");
    expect(first).toHaveValue(shown);
  });

  it("choosing 0 clears an out-of-range capo", () => {
    const { onChange } = setup({ capo: "25" });
    // Precondition: the select does not already show 0, so 0 is a real change.
    expect(field("meta-capo")).toHaveValue("25");
    fireEvent.change(field("meta-capo"), { target: { value: "0" } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("capo", "");
  });

  it("choosing a number replaces an out-of-range capo", () => {
    const { onChange } = setup({ capo: "abc" });
    expect(field("meta-capo")).toHaveValue("abc");
    fireEvent.change(field("meta-capo"), { target: { value: "4" } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("capo", "4");
  });

  it("drops the extra choice once the stored capo is valid or empty", () => {
    const { update } = setup({ capo: "25" });
    expect(capoChoices()).toHaveLength(14);
    update({ capo: "" });
    expect(field("meta-capo")).toHaveValue("0");
    expect(capoChoices()).toHaveLength(13);
    update({ capo: "3" });
    expect(field("meta-capo")).toHaveValue("3");
    expect(capoChoices()).toHaveLength(13);
  });

  it.each([
    ["0", "0"],
    ["12", "12"],
    ["24", "24"],
    [" 7 ", "7"],
  ])("shows capo %j as %s", (capo, shown) => {
    setup({ capo });
    expect(field("meta-capo")).toHaveValue(shown);
  });
});
