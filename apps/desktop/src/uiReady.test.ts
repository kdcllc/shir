import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn() }));

async function load() {
  const { isTauri } = await import("@tauri-apps/api/core");
  const { emit } = await import("@tauri-apps/api/event");
  const mod = await import("./uiReady");
  return { isTauri: vi.mocked(isTauri), emit: vi.mocked(emit), ...mod };
}

describe("signalUiReady", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  it("uses the frozen event name", async () => {
    const { UI_READY_EVENT } = await load();
    expect(UI_READY_EVENT).toBe("shir://ui-ready");
  });

  it("emits exactly once inside Tauri", async () => {
    const { isTauri, emit, signalUiReady } = await load();
    isTauri.mockReturnValue(true);
    emit.mockResolvedValue(undefined);
    await signalUiReady();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("shir://ui-ready");
  });

  it("two calls inside Tauri emit once", async () => {
    const { isTauri, emit, signalUiReady } = await load();
    isTauri.mockReturnValue(true);
    emit.mockResolvedValue(undefined);
    await signalUiReady();
    await signalUiReady();
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("two concurrent calls inside Tauri emit once (StrictMode double effect)", async () => {
    const { isTauri, emit, signalUiReady } = await load();
    isTauri.mockReturnValue(true);
    emit.mockResolvedValue(undefined);
    await Promise.all([signalUiReady(), signalUiReady()]);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("does not emit outside Tauri", async () => {
    const { isTauri, emit, signalUiReady } = await load();
    isTauri.mockReturnValue(false);
    await signalUiReady();
    expect(emit).not.toHaveBeenCalled();
  });

  it("a call outside Tauri does not consume the once-flag", async () => {
    const { isTauri, emit, signalUiReady } = await load();
    emit.mockResolvedValue(undefined);
    isTauri.mockReturnValue(false);
    await signalUiReady();
    isTauri.mockReturnValue(true);
    await signalUiReady();
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("catches and logs a rejected emit once without retrying", async () => {
    const { isTauri, emit, signalUiReady } = await load();
    const error = new Error("boom");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    isTauri.mockReturnValue(true);
    emit.mockRejectedValue(error);
    await expect(signalUiReady()).resolves.toBeUndefined();
    await expect(signalUiReady()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]).toContain(error);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
