/**
 * Tests for DiagnosticAggregator — the orchestrator that feeds the store.
 */

import { describe, expect, it, vi } from "vitest";
import { DiagnosticAggregator } from "../../src/diagnostics/DiagnosticAggregator.js";
import { DiagnosticStore } from "../../src/diagnostics/DiagnosticStore.js";
import { InMemoryEventBus } from "../../src/events/InMemoryEventBus.js";
import { diagnosticId, type Diagnostic } from "@nodeforge/contracts";

function makeDiag(source: string, line: number): Diagnostic {
  const file = "/workspace/src/foo.ts";
  return {
    id: diagnosticId({ source, rule: "r1", file, line, column: 1 }),
    source,
    severity: "error",
    message: "test",
    file,
    range: { line, column: 1 },
    rule: "r1",
    fixable: false
  };
}

describe("DiagnosticAggregator", () => {
  it("records diagnostics into the store", () => {
    const bus = new InMemoryEventBus();
    const store = new DiagnosticStore(bus);
    const agg = new DiagnosticAggregator(store);

    agg.record("typescript", [makeDiag("typescript", 10)]);
    expect(store.by("typescript")).toHaveLength(1);
  });

  it("replaces previous diagnostics on re-record", () => {
    const bus = new InMemoryEventBus();
    const store = new DiagnosticStore(bus);
    const agg = new DiagnosticAggregator(store);

    agg.record("typescript", [makeDiag("typescript", 10)]);
    agg.record("typescript", [makeDiag("typescript", 20), makeDiag("typescript", 30)]);

    const ts = store.by("typescript");
    expect(ts).toHaveLength(2);
    expect(ts[0]!.range.line).toBe(20);
    expect(ts[1]!.range.line).toBe(30);
  });

  it("clears a single source via clear()", () => {
    const bus = new InMemoryEventBus();
    const store = new DiagnosticStore(bus);
    const agg = new DiagnosticAggregator(store);

    agg.record("typescript", [makeDiag("typescript", 10)]);
    agg.record("eslint", [makeDiag("eslint", 20)]);
    agg.clear("typescript");

    expect(store.by("typescript")).toHaveLength(0);
    expect(store.by("eslint")).toHaveLength(1);
  });

  it("clears everything via clearAll()", () => {
    const bus = new InMemoryEventBus();
    const store = new DiagnosticStore(bus);
    const agg = new DiagnosticAggregator(store);

    agg.record("typescript", [makeDiag("typescript", 10)]);
    agg.record("eslint", [makeDiag("eslint", 20)]);
    agg.clearAll();

    expect(store.all()).toHaveLength(0);
  });

  it("publishes snapshot events when records change", () => {
    const bus = new InMemoryEventBus();
    const store = new DiagnosticStore(bus);
    const agg = new DiagnosticAggregator(store);
    const handler = vi.fn();
    bus.subscribe("diagnostics.snapshot", handler);

    agg.record("typescript", [makeDiag("typescript", 10)]);
    agg.record("eslint", [makeDiag("eslint", 20)]);
    agg.clear("typescript");
    agg.clearAll();

    // record → publish; record → publish; clear (typescript existed) → publish + cleared;
    // clearAll → publish (even though empty, the event still fires).
    expect(handler).toHaveBeenCalledTimes(4);
  });
});
