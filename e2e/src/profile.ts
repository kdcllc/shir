import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildLaunchEnv,
  profileAt,
  renderWrapper,
  type Profile,
} from "./launch";

/** The Shir debug binary; override with `SHIR_E2E_APP`. */
export function appBinary(repoRoot: string): string {
  return (
    process.env["SHIR_E2E_APP"] ||
    path.join(repoRoot, "apps/desktop/src-tauri/target/debug/shir")
  );
}

/**
 * Creates a fresh, empty profile. It lives under the run directory when one is set
 * (`onComplete` removes that whole tree, which also catches directories the app
 * recreates while it shuts down), else under the OS temp directory.
 */
export function createProfile(): Profile {
  const base = process.env["SHIR_E2E_RUN_DIR"] || os.tmpdir();
  const profile = profileAt(mkdtempSync(path.join(base, "profile-")));
  for (const dir of [profile.dataHome, profile.configHome, profile.cacheHome]) {
    mkdirSync(dir, { recursive: true });
  }
  return profile;
}

export function removeProfile(profile: Profile): void {
  rmSync(profile.root, { recursive: true, force: true });
}

/** (Re)writes the launch wrapper so the next app start uses `profile` and `lang`. */
export function writeWrapper(
  wrapperPath: string,
  binary: string,
  profile: Profile,
  lang: string,
): void {
  writeFileSync(
    wrapperPath,
    renderWrapper(binary, buildLaunchEnv(profile, lang)),
  );
  chmodSync(wrapperPath, 0o755);
}

/** Per-worker launch state, kept on `globalThis` so the config hooks and the specs share it. */
export interface LaunchState {
  wrapper: string;
  binary: string;
  profile: Profile;
  lang: string;
}

const KEY = "__shirE2eLaunchState";
type Holder = { [KEY]?: LaunchState };

export function launchState(): LaunchState {
  const state = (globalThis as Holder)[KEY];
  if (state === undefined)
    throw new Error("e2e: no launch state; beforeSession did not run");
  return state;
}

/** `beforeSession`: a fresh profile and wrapper for the spec file about to start. */
export function startLaunchState(
  wrapper: string,
  binary: string,
  lang: string,
): LaunchState {
  const state: LaunchState = {
    wrapper,
    binary,
    profile: createProfile(),
    lang,
  };
  writeWrapper(wrapper, binary, state.profile, lang);
  (globalThis as Holder)[KEY] = state;
  return state;
}

/** `afterSession`: removes the spec file's temporary profile. */
export function stopLaunchState(): void {
  const state = (globalThis as Holder)[KEY];
  if (state === undefined) return;
  removeProfile(state.profile);
  delete (globalThis as Holder)[KEY];
}

/** Switches the state to a new profile and/or locale and rewrites the wrapper. */
export function prepareRelaunch(opts: {
  lang?: string | undefined;
  fresh?: boolean | undefined;
}): LaunchState {
  const state = launchState();
  if (opts.fresh === true) {
    removeProfile(state.profile);
    state.profile = createProfile();
  }
  if (opts.lang !== undefined) state.lang = opts.lang;
  writeWrapper(state.wrapper, state.binary, state.profile, state.lang);
  return state;
}
