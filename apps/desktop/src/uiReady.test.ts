import { isTauri } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UI_READY_EVENT, signalUiReady } from "./uiReady";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn() }));

describe("signalUiReady", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  it("uses the frozen event name", () => {
    expect(UI_READY_EVENT).toBe("shir://ui-ready");
  });

  it("emits exactly once inside Tauri", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(emit).mockResolvedValue(undefined);
    await signalUiReady();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("shir://ui-ready");
  });

  it("does not emit outside Tauri", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    await signalUiReady();
    expect(emit).not.toHaveBeenCalled();
  });

  it("catches and logs a rejected emit", async () => {
    const error = new Error("boom");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(emit).mockRejectedValue(error);
    await expect(signalUiReady()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]).toContain(error);
  });
});
