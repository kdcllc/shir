import { describe, expect, it, vi } from "vitest";
import { deleteMany } from "./deleteSongs";
import { StorageError } from "./storage";

describe("deleteMany", () => {
  it("removes every id and reports them as deleted in the given order", async () => {
    const remove = vi.fn(() => Promise.resolve());
    const outcome = await deleteMany(["b", "a", "c"], remove);
    expect(remove.mock.calls).toEqual([["b"], ["a"], ["c"]]);
    expect(outcome).toEqual({ deleted: ["b", "a", "c"], failed: [] });
  });

  it("runs sequentially: an id starts only after the previous one settled", async () => {
    const log: string[] = [];
    const remove = async (id: string) => {
      log.push(`start ${id}`);
      await new Promise((r) => setTimeout(r, id === "a" ? 15 : 1));
      log.push(`end ${id}`);
    };
    await deleteMany(["a", "b"], remove);
    expect(log).toEqual(["start a", "end a", "start b", "end b"]);
  });

  it("removes duplicate ids before running, keeping first-seen order", async () => {
    const remove = vi.fn(() => Promise.resolve());
    const outcome = await deleteMany(["a", "b", "a", "b", "c"], remove);
    expect(remove.mock.calls).toEqual([["a"], ["b"], ["c"]]);
    expect(outcome.deleted).toEqual(["a", "b", "c"]);
  });

  it("a rejection is recorded with the error message and never stops the rest", async () => {
    const remove = vi.fn((id: string) =>
      id === "b" ? Promise.reject(new Error("locked")) : Promise.resolve(),
    );
    const outcome = await deleteMany(["a", "b", "c"], remove);
    expect(remove).toHaveBeenCalledTimes(3);
    expect(outcome).toEqual({
      deleted: ["a", "c"],
      failed: [{ id: "b", message: "locked" }],
    });
  });

  it("counts a NotFound storage error as deleted", async () => {
    const remove = (id: string) =>
      id === "a"
        ? Promise.reject(new StorageError("NotFound", "no such song"))
        : Promise.resolve();
    expect(await deleteMany(["a", "b"], remove)).toEqual({
      deleted: ["a", "b"],
      failed: [],
    });
  });

  it("records every other storage error kind as a failure", async () => {
    const remove = () =>
      Promise.reject(new StorageError("Storage", "disk I/O error"));
    expect(await deleteMany(["a"], remove)).toEqual({
      deleted: [],
      failed: [{ id: "a", message: "disk I/O error" }],
    });
  });

  it("uses String(reason) for a rejection that is not an Error", async () => {
    const reasons: Record<string, unknown> = { a: "plain", b: 42, c: null };
    const remove = (id: string) => Promise.reject(reasons[id]);
    const outcome = await deleteMany(["a", "b", "c"], remove);
    expect(outcome.failed).toEqual([
      { id: "a", message: "plain" },
      { id: "b", message: "42" },
      { id: "c", message: "null" },
    ]);
  });

  it("never rejects, even when remove throws synchronously", async () => {
    const remove = (id: string): Promise<void> => {
      if (id === "a") throw new Error("sync boom");
      return Promise.resolve();
    };
    await expect(deleteMany(["a", "b"], remove)).resolves.toEqual({
      deleted: ["b"],
      failed: [{ id: "a", message: "sync boom" }],
    });
  });

  it("returns an empty outcome for no ids without calling remove", async () => {
    const remove = vi.fn(() => Promise.resolve());
    expect(await deleteMany([], remove)).toEqual({ deleted: [], failed: [] });
    expect(remove).not.toHaveBeenCalled();
  });
});
