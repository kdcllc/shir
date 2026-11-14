import { describe, expect, it } from "vitest";
import { firstStrongDirection } from "./direction";

describe("firstStrongDirection", () => {
  it("returns rtl for Hebrew with niqqud", () => {
    expect(firstStrongDirection("שָׁלוֹם")).toBe("rtl");
  });
  it("returns ltr for English", () => {
    expect(firstStrongDirection("rock and roll")).toBe("ltr");
  });
  it("uses the first strong letter in mixed text", () => {
    expect(firstStrongDirection("שלום rock")).toBe("rtl");
    expect(firstStrongDirection("rock שלום")).toBe("ltr");
  });
  it("returns null without strong characters", () => {
    expect(firstStrongDirection("123 !? ")).toBeNull();
    expect(firstStrongDirection("")).toBeNull();
  });
  it("treats marks as neutral", () => {
    expect(firstStrongDirection("ְָׁabc")).toBe("ltr");
  });
  it("is ltr when chord text leads the lyric", () => {
    expect(firstStrongDirection("(F#m7) שיר")).toBe("ltr");
  });
  it("returns rtl for Arabic letters", () => {
    expect(firstStrongDirection("مرحبا")).toBe("rtl");
  });
  it("treats RLM as strong rtl when first", () => {
    expect(firstStrongDirection("\u200Fabc")).toBe("rtl");
  });
  it("treats LRM as strong ltr when first", () => {
    expect(firstStrongDirection("\u200Eשלום")).toBe("ltr");
  });
  it("treats ALM as strong rtl when first", () => {
    expect(firstStrongDirection("\u061Cabc")).toBe("rtl");
  });
  it("ignores a mark after a strong letter", () => {
    expect(firstStrongDirection("a\u200F")).toBe("ltr");
  });
});
