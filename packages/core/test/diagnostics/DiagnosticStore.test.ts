/**
 * Tests for DiagnosticStore — the normalized in-memory diagnostic cache.
 */

import { describe, expect, it, vi } from "vitest";
import { DiagnosticStore } from "../../src/diagnostics/DiagnosticStore.js";
import { InMemoryEventBus } from "../../src/events/InMemoryEventBus.js";
import { diagnosticId, type Diagnostic } from "@nodeforge/contracts";

function makeDiag(
  source: string,
  opts: { file?: string; line?: number; column?: number; severity?: Diagnostic["severity"]; rule?: string } = {}
): Diagnostic {
  const file = opts.file ?? "/workspace/src/foo.ts";
  const line = opts.line ?? 1;
  const column = opts.column ?? 1;
  const severity = opts.severity ?? "error";
  return {
    id: diagnosticId({ source, rule: opts.rule ?? "r1", file, line, column }),
    source,
    severity,
    message: "test diagnostic",
    file,
    range: { line, column },
    rule: opts.rule ?? "r1",
    fixable: false
  };
}

describe("DiagnosticStore", () => {
  it("publishes diagnostics grouped by source", () => {
    const bus = new InMemoryEventBus();
    const store = new DiagnosticStore(bus);

    store.publish("typescript", [makeDiag("typescript", { line: 10 })]);
    store.publish("eslint", [makeDiag("eslint", { line: 20 })]);

    expect(store.by("typescript")).toHaveLength(1);
    expect(store.by("eslint")).toHaveLength(1);
    expect(store.all()).toHaveLength(2);
    expect(store.sources()).toEqual(["eslint", "typescript"]);
  });

  it("replaces diagnostics for the same source on re-publish", () => {
    const bus = new InMemoryEventBus();
    const store = new DiagnosticStore(bus);

    store.publish("typescript", [makeDiag("typescript", { line: 10 })]);
    expect(store.by("typescript")).toHaveLength(1);
    expect(store.by("typescript")[0]!.range.line).toBe(10);

    store.publish("typescript", [
      makeDiag("typescript", { line: 20 }),
      makeDiag("typescript", { line: 30 })
    ]);

    expect(store.by("typescript")).toHaveLength(2);
    expect(store.by("typescript")[0]!.range.line).toBe(20);
    expect(store.by("typescript")[1]!.range.line).toBe(30);
  });

  it("computes counts across all sources", () => {
    const bus = new InMemoryEventBus();
    const store = new DiagnosticStore(bus);

    store.publish("typescript", [
      makeDiag("typescript", { severity: "error", line: 1 }),
      makeDiag("typescript", { severity: "warning", line: 2 })
    ]);
    store.publish("eslint", [
      makeDiag("eslint", { severity: "warning", line: 3 }),
      makeDiag("eslint", { severity: "info", line: 4 })
    ]);

    const counts = store.counts();
    expect(counts.error).toBe(1);
    expect(counts.warning).toBe(2);
    expect(counts.info).toBe(1);
    expect(counts.hint).toBe(0);
  });

  it("clears a single source", () => {
    const bus = new InMemoryEventBus();
    const store = new DiagnosticStore(bus);

    store.publish("typescript", [makeDiag("typescript")]);
    store.publish("eslint", [makeDiag("eslint")]);
    store.clear("typescript");

    expect(store.by("typescript")).toHaveLength(0);
    expect(store.by("eslint")).toHaveLength(1);
    expect(store.all()).toHaveLength(1);
  });

  it("publishes diagnostics.snapshot event on every change", () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();
    bus.subscribe("diagnostics.snapshot", handler);
    const store = new DiagnosticStore(bus);

    store.publish("typescript", [makeDiag("typescript")]);
    store.clear("typescript");

    // Initial publish + clear → 2 snapshot events (clear only fires if source existed).
    expect(handler).toHaveBeenCalledTimes(2);
    const firstCall = handler.mock.calls[0]![0];
    expect(firstCall.type).toBe("diagnostics.snapshot");
    expect(firstCall.snapshot.diagnostics).toHaveLength(1);
    expect(firstCall.snapshot.counts.error).toBe(1);
  });

  it("publishes diagnostics.cleared event when a source is cleared", () => {
    const bus = new InMemoryEventBus();
    const clearedHandler = vi.fn();
    bus.subscribe("diagnostics.cleared", clearedHandler);
    const store = new DiagnosticStore(bus);

    store.publish("typescript", [makeDiag("typescript")]);
    store.clear("typescript");
    store.clear("typescript"); // second time — should NOT fire again

    expect(clearedHandler).toHaveBeenCalledTimes(1);
    expect(clearedHandler).toHaveBeenCalledWith({ type: "diagnostics.cleared", source: "typescript" });
  });

  it("snapshot captures current state immutably", () => {
    const bus = new InMemoryEventBus();
    const store = new DiagnosticStore(bus);

    store.publish("typescript", [makeDiag("typescript")]);
    const snap = store.snapshot();

    expect(snap.capturedAt).toBeGreaterThan(0);
    expect(snap.counts.error).toBe(1);
    expect(snap.diagnostics).toHaveLength(1);

    // Mutating the snapshot should not affect the store.
    snap.diagnostics.length = 0;
    expect(store.all()).toHaveLength(1);
  });

  it("clearAll removes everything and publishes a snapshot", () => {
    const bus = new InMemoryEventBus();
    const snapshotHandler = vi.fn();
    bus.subscribe("diagnostics.snapshot", snapshotHandler);
    const store = new DiagnosticStore(bus);

    store.publish("typescript", [makeDiag("typescript")]);
    store.publish("eslint", [makeDiag("eslint")]);
    snapshotHandler.mockClear();

    store.clearAll();

    expect(store.all()).toHaveLength(0);
    expect(snapshotHandler).toHaveBeenCalledTimes(1);
    const lastCall = snapshotHandler.mock.calls[0]![0];
    expect(lastCall.snapshot.diagnostics).toHaveLength(0);
  });
});
