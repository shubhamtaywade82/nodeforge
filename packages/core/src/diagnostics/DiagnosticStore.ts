/**
 * DiagnosticStore — in-memory store of all normalized diagnostics across sources.
 *
 * The store is the single source of truth for "what does NodeForge currently
 * know is wrong with the workspace?". The UI and agent read from here; the
 * aggregator writes to here.
 *
 * The store is keyed by `DiagnosticSource` so a single adapter can refresh
 * its slice without touching others. After each write, the store publishes
 * a `diagnostics.snapshot` event on the bus.
 */

import {
  type Diagnostic,
  type DiagnosticSeverity,
  type DiagnosticSnapshot,
  type EventBus
} from "@nodeforge/contracts";

const SEVERITIES: DiagnosticSeverity[] = ["error", "warning", "info", "hint"];

export class DiagnosticStore {
  /** source → Set<Diagnostic> */
  private readonly bySource = new Map<string, Set<Diagnostic>>();

  constructor(private readonly bus: EventBus) {}

  /**
   * Replace all diagnostics for `source`. Subsequent reads will reflect the
   * new set atomically. Publishes a `diagnostics.snapshot` event.
   */
  publish(source: string, diagnostics: Diagnostic[]): void {
    const next = new Set<Diagnostic>();
    for (const d of diagnostics) next.add(d);
    this.bySource.set(source, next);

    this.bus.publish({ type: "diagnostics.snapshot", snapshot: this.snapshot() });
  }

  /** Clear all diagnostics for `source`. Publishes a snapshot event. */
  clear(source: string): void {
    if (this.bySource.delete(source)) {
      this.bus.publish({ type: "diagnostics.cleared", source });
      this.bus.publish({ type: "diagnostics.snapshot", snapshot: this.snapshot() });
    }
  }

  /** Clear everything. */
  clearAll(): void {
    this.bySource.clear();
    this.bus.publish({ type: "diagnostics.snapshot", snapshot: this.snapshot() });
  }

  /** Returns all diagnostics across all sources. */
  all(): Diagnostic[] {
    const out: Diagnostic[] = [];
    for (const set of this.bySource.values()) {
      for (const d of set) out.push(d);
    }
    return out;
  }

  /** Returns only diagnostics from `source`. */
  by(source: string): Diagnostic[] {
    const set = this.bySource.get(source);
    return set ? Array.from(set) : [];
  }

  /** Returns the count of diagnostics by severity, across all sources. */
  counts(): Record<DiagnosticSeverity, number> {
    const counts: Record<DiagnosticSeverity, number> = {
      error: 0,
      warning: 0,
      info: 0,
      hint: 0
    };
    for (const set of this.bySource.values()) {
      for (const d of set) counts[d.severity]++;
    }
    return counts;
  }

  /** Builds an immutable snapshot for the event bus. */
  snapshot(): DiagnosticSnapshot {
    return {
      capturedAt: Date.now(),
      counts: this.counts(),
      diagnostics: this.all()
    };
  }

  /** Returns the list of currently-known sources (e.g. `["typescript", "eslint"]`). */
  sources(): string[] {
    return Array.from(this.bySource.keys()).sort();
  }

  /** Returns the set of severities tracked — used internally by the UI to render counts. */
  static knownSeverities(): DiagnosticSeverity[] {
    return SEVERITIES;
  }
}
