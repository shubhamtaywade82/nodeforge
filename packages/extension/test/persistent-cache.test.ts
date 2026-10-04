import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PersistentCache, type MementoLike } from "../src/core/PersistentCache.ts";

class FakeMemento implements MementoLike {
  readonly store = new Map<string, unknown>();
  get(key: string): unknown {
    return this.store.get(key);
  }
  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) this.store.delete(key);
    else this.store.set(key, value);
  }
}

const isNamed = (d: unknown): d is { name: string } =>
  typeof d === "object" && d !== null && typeof (d as { name?: unknown }).name === "string";
const make = (m: MementoLike, now: () => number, version = 1): PersistentCache<{ name: string }> =>
  new PersistentCache(m, "k", version, 1000, isNamed, now);

describe("PersistentCache", () => {
  it("round-trips within the same scope", async () => {
    const m = new FakeMemento();
    const c = make(m, () => 100);
    await c.write("/w", { name: "a" });
    assert.deepEqual(c.read("/w"), { name: "a" });
  });

  it("misses on a different scope, version, or expiry", async () => {
    const m = new FakeMemento();
    let t = 100;
    const c = make(m, () => t);
    await c.write("/w", { name: "a" });
    assert.equal(c.read("/other"), undefined);
    assert.equal(make(m, () => t, 2).read("/w"), undefined);
    t = 1101;
    assert.equal(c.read("/w"), undefined);
  });

  it("treats a clock that moved backwards, malformed entries, and invalid data as misses", async () => {
    const m = new FakeMemento();
    let t = 5000;
    const c = make(m, () => t);
    await c.write("/w", { name: "a" });
    t = 10;
    assert.equal(c.read("/w"), undefined);
    for (const bad of ["garbage", null, { v: 1, scope: "/w", savedAt: 100, data: { name: 5 } }]) {
      m.store.set("k", bad);
      assert.equal(make(m, () => 100).read("/w"), undefined);
    }
  });

  it("clears the entry", async () => {
    const m = new FakeMemento();
    const c = make(m, () => 100);
    await c.write("/w", { name: "a" });
    await c.clear();
    assert.equal(c.read("/w"), undefined);
  });
});
