import { describe, expect, it } from "vitest";
import {
  LANGS,
  buildLaunchEnv,
  isInside,
  profileAt,
  renderWrapper,
  shellQuote,
} from "./launch";

describe("buildLaunchEnv", () => {
  const profile = profileAt("/tmp/shir-e2e-profile-abc");

  it("points all three XDG directories inside the temporary profile", () => {
    const env = buildLaunchEnv(profile, LANGS.en);
    for (const key of ["XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"]) {
      expect(isInside(profile.root, env[key] ?? "/"), key).toBe(true);
    }
    expect(
      new Set([
        env["XDG_DATA_HOME"],
        env["XDG_CONFIG_HOME"],
        env["XDG_CACHE_HOME"],
      ]).size,
    ).toBe(3);
  });

  it("sets LANG, LC_ALL and LANGUAGE for the requested locale", () => {
    expect(buildLaunchEnv(profile, LANGS.he)).toMatchObject({
      LANG: "he_IL.UTF-8",
      LC_ALL: "he_IL.UTF-8",
      LANGUAGE: "he_IL",
    });
    expect(buildLaunchEnv(profile, LANGS.en)).toMatchObject({
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      LANGUAGE: "en_US",
    });
  });
});

describe("renderWrapper", () => {
  it("exports the environment and execs the binary, forwarding arguments", () => {
    const script = renderWrapper("/opt/shir/bin/shir", {
      XDG_DATA_HOME: "/tmp/p/data",
      LANG: "he_IL.UTF-8",
    });
    expect(script.split("\n")).toEqual([
      "#!/bin/sh",
      "export XDG_DATA_HOME='/tmp/p/data'",
      "export LANG='he_IL.UTF-8'",
      `exec '/opt/shir/bin/shir' "$@"`,
      "",
    ]);
  });

  it("quotes single quotes so a path cannot break out of the script", () => {
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`);
    const script = renderWrapper("/tmp/it's/shir", { LANG: "x'; rm -rf /; '" });
    expect(script).toContain(`exec '/tmp/it'\\''s/shir' "$@"`);
    expect(script).toContain(`export LANG='x'\\''; rm -rf /; '\\'''`);
  });
});

describe("isInside", () => {
  it("accepts the root and its descendants and rejects siblings and escapes", () => {
    expect(isInside("/tmp/a", "/tmp/a")).toBe(true);
    expect(isInside("/tmp/a", "/tmp/a/b/c")).toBe(true);
    expect(isInside("/tmp/a", "/tmp/ab")).toBe(false);
    expect(isInside("/tmp/a", "/tmp/a/../b")).toBe(false);
    expect(isInside("/tmp/a", "/home/user/.local/share")).toBe(false);
  });
});
