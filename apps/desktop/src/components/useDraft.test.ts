import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDraft } from "./useDraft";

interface HostProps {
  value: string;
  commit(next: string): void;
}

/** A text input driven by the hook, as the widgets use it. */
function Host({ value, commit }: HostProps) {
  return createElement("input", { type: "text", ...useDraft(value, commit) });
}

function setup(value = "") {
  const commit = vi.fn();
  const view = render(createElement(Host, { value, commit }));
  const update = (next: string) =>
    view.rerender(createElement(Host, { value: next, commit }));
  return { commit, update };
}

const input = () => screen.getByRole<HTMLInputElement>("textbox");
const type = (value: string) =>
  fireEvent.change(input(), { target: { value } });

describe("useDraft", () => {
  it("shows the value and keeps typing local", () => {
    const { commit } = setup("Old");
    expect(input()).toHaveValue("Old");
    type("  New ");
    expect(input()).toHaveValue("  New ");
    expect(commit).not.toHaveBeenCalled();
  });

  it("blur commits the trimmed draft once", () => {
    const { commit } = setup("Old");
    type("  New  ");
    fireEvent.blur(input());
    fireEvent.blur(input());
    expect(commit).toHaveBeenCalledExactlyOnceWith("New");
    // The draft itself is not rewritten by the commit.
    expect(input()).toHaveValue("  New  ");
  });

  it("Enter commits the trimmed draft once and is not left to the browser", () => {
    const { commit } = setup();
    type(" Typed ");
    const allowed = fireEvent.keyDown(input(), { key: "Enter" });
    expect(allowed).toBe(false);
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.blur(input());
    expect(commit).toHaveBeenCalledExactlyOnceWith("Typed");
  });

  it("does not commit when the trimmed draft equals the value", () => {
    const { commit } = setup("Same");
    fireEvent.blur(input());
    type("  Same  ");
    fireEvent.blur(input());
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(commit).not.toHaveBeenCalled();
  });

  it("a draft of only spaces commits the empty string", () => {
    const { commit } = setup("Gone");
    type("   ");
    fireEvent.blur(input());
    expect(commit).toHaveBeenCalledExactlyOnceWith("");
  });

  it("commits again after the draft is edited again", () => {
    const { commit } = setup();
    type("One");
    fireEvent.blur(input());
    type("Two");
    fireEvent.blur(input());
    type("One");
    fireEvent.blur(input());
    expect(commit.mock.calls).toEqual([["One"], ["Two"], ["One"]]);
  });

  it("Escape restores the value without committing", () => {
    const { commit } = setup("Kept");
    type("Thrown away");
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(input()).toHaveValue("Kept");
    fireEvent.blur(input());
    expect(commit).not.toHaveBeenCalled();
  });

  it("Escape after a commit lets the same text be committed again", () => {
    const { commit } = setup("Kept");
    type("Sent");
    fireEvent.blur(input());
    fireEvent.keyDown(input(), { key: "Escape" });
    type("Sent");
    fireEvent.blur(input());
    expect(commit.mock.calls).toEqual([["Sent"], ["Sent"]]);
  });

  it("other keys neither commit nor are prevented", () => {
    const { commit } = setup("Old");
    type("New");
    const allowed = fireEvent.keyDown(input(), { key: "Tab" });
    expect(allowed).toBe(true);
    expect(commit).not.toHaveBeenCalled();
  });

  it("an outside change of the value replaces the draft", () => {
    const { commit, update } = setup("First");
    type("Half typed");
    update("Undone");
    expect(input()).toHaveValue("Undone");
    fireEvent.blur(input());
    expect(commit).not.toHaveBeenCalled();
  });

  it("a rerender with the same value leaves the draft alone", () => {
    const { commit, update } = setup("First");
    type("Half typed");
    update("First");
    expect(input()).toHaveValue("Half typed");
    fireEvent.blur(input());
    expect(commit).toHaveBeenCalledExactlyOnceWith("Half typed");
  });

  it("commits Hebrew text with niqqud unchanged", () => {
    const { commit } = setup();
    const hebrew = "שִׁיר חָדָשׁ";
    type(hebrew);
    fireEvent.blur(input());
    expect(commit).toHaveBeenCalledExactlyOnceWith(hebrew);
  });
});
