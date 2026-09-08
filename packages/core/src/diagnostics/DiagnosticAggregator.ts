/**
 * DiagnosticAggregator — orchestrates multiple adapters and feeds their
 * results into a `DiagnosticStore`.
 *
 * The aggregator does NOT own the adapters (the extension does, because
 * extension activation is what creates adapter instances with their
 * constructor deps). Instead, the aggregator exposes a simple
 * `record(source, diagnostics)` API that any caller can use.
 *
 * This indirection exists so the aggregator can later add:
 *   - deduplication across sources (same finding from tsc AND eslint)
 *   - severity-based filtering
 *   - per-source debouncing
 *   - file-change invalidation
 *
 * For v0.0.x, it just forwards to the store.
 */

import type { Diagnostic } from "@nodeforge/contracts";
import { DiagnosticStore } from "./DiagnosticStore.js";

export class DiagnosticAggregator {
  constructor(private readonly store: DiagnosticStore) {}

  /**
   * Record a fresh batch of diagnostics for `source`. Replaces any prior
   * diagnostics from the same source.
   */
  record(source: string, diagnostics: Diagnostic[]): void {
    this.store.publish(source, diagnostics);
  }

  /** Clear diagnostics for `source` (e.g. when the adapter found nothing). */
  clear(source: string): void {
    this.store.clear(source);
  }

  /** Clear everything. */
  clearAll(): void {
    this.store.clearAll();
  }
}
