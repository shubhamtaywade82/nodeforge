/**
 * DiagnosticManager — orchestrates which diagnostic adapters run for the
 * current workspace, based on the detected `WorkspaceProfile`.
 *
 * The manager subscribes to `workspace.profiled` events. When a profile
 * arrives, it determines which adapters are applicable:
 *
 *   typescript === true                  → run TypeScript adapter
 *   linter === "eslint"                   → run ESLint adapter
 *   linter === "biome"                    → run Biome adapter
 *
 * The manager exposes:
 *   - `refresh()` — re-run all enabled adapters and record results into the store
 *   - `triggerOnSave()` — debounced trigger for save events
 *   - `current()` — snapshot of the latest diagnostic store state
 *
 * All adapter runs go through the shared `ProcessRunner` and are cancellable
 * via an AbortController owned by the manager. If a new refresh starts while
 * the previous one is still running, the previous one is cancelled.
 */

import type { EventBus, WorkspaceProfile } from "@nodeforge/contracts";
import { DiagnosticAggregator, DiagnosticStore, type FilesystemReader } from "@nodeforge/core";
import { detectWorkspaceProfile } from "@nodeforge/core";
import { ProcessRunner } from "@nodeforge/runner";
import { TypescriptAdapter } from "@nodeforge/adapter-typescript";
import { EslintAdapter } from "@nodeforge/adapter-eslint";
import { BiomeAdapter } from "@nodeforge/adapter-biome";

export interface DiagnosticManagerOptions {
  /** Debounce window in ms for save-triggered refreshes. Defaults to 500. */
  saveDebounceMs?: number;
}

interface EnabledAdapters {
  typescript: TypescriptAdapter | undefined;
  eslint: EslintAdapter | undefined;
  biome: BiomeAdapter | undefined;
}

export class DiagnosticManager {
  private readonly store: DiagnosticStore;
  private readonly aggregator: DiagnosticAggregator;
  private readonly runner: ProcessRunner;
  private readonly reader: FilesystemReader;
  private readonly bus: EventBus;

  private profile: WorkspaceProfile | undefined;
  private adapters: EnabledAdapters = { typescript: undefined, eslint: undefined, biome: undefined };
  private currentRun: AbortController | undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly saveDebounceMs: number;

  constructor(
    reader: FilesystemReader,
    runner: ProcessRunner,
    bus: EventBus,
    options: DiagnosticManagerOptions = {}
  ) {
    this.reader = reader;
    this.runner = runner;
    this.bus = bus;
    this.store = new DiagnosticStore(bus);
    this.aggregator = new DiagnosticAggregator(this.store);
    this.saveDebounceMs = options.saveDebounceMs ?? 500;

    // Whenever the workspace profile changes, reconfigure adapters.
    this.bus.subscribe("workspace.profiled", (e) => {
      this.onProfileChanged(e.profile);
    });
  }

  /** Returns the live diagnostic store. UI reads from here. */
  getStore(): DiagnosticStore {
    return this.store;
  }

  /** Update the cached profile and reconfigure adapters. Called when the bus
   * emits a `workspace.profiled` event. Exposed publicly for tests. */
  onProfileChanged(profile: WorkspaceProfile): void {
    this.profile = profile;
    this.adapters = {
      typescript: profile.typescript ? new TypescriptAdapter(this.runner) : undefined,
      eslint: profile.linter === "eslint" ? new EslintAdapter(this.runner) : undefined,
      biome: profile.linter === "biome" ? new BiomeAdapter(this.runner) : undefined
    };
  }

  /**
   * Re-run all enabled adapters in parallel and record results into the store.
   * Cancels any in-flight refresh.
   */
  async refresh(): Promise<void> {
    if (!this.profile) {
      return;
    }
    // Cancel any in-flight run.
    if (this.currentRun) {
      this.currentRun.abort();
    }
    const controller = new AbortController();
    this.currentRun = controller;
    const signal = controller.signal;

    const root = this.profile.root;
    const tasks: Array<Promise<void>> = [];

    if (this.adapters.typescript) {
      tasks.push(this.runTypescript(root, signal));
    }
    if (this.adapters.eslint) {
      tasks.push(this.runEslint(root, signal));
    }
    if (this.adapters.biome) {
      tasks.push(this.runBiome(root, signal));
    }

    await Promise.allSettled(tasks);
    if (this.currentRun === controller) {
      this.currentRun = undefined;
    }
  }

  /**
   * Trigger a debounced refresh (used by save listeners). Multiple calls
   * within `saveDebounceMs` collapse into a single refresh.
   */
  triggerOnSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.refresh().catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[nodeforge:diagnostic-manager] save-triggered refresh failed", err);
      });
    }, this.saveDebounceMs);
  }

  /** Cancels any in-flight refresh and clears the save debounce timer. */
  dispose(): void {
    if (this.currentRun) {
      this.currentRun.abort();
      this.currentRun = undefined;
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
  }

  private async runTypescript(root: string, signal: AbortSignal): Promise<void> {
    if (!this.adapters.typescript) return;
    try {
      const result = await this.adapters.typescript.run(root, signal);
      this.aggregator.record("typescript", result.diagnostics);
    } catch (err) {
      // If cancelled, clear the source — the next refresh will repopulate.
      if (isAbortError(err)) {
        this.aggregator.clear("typescript");
        return;
      }
      // eslint-disable-next-line no-console
      console.error("[nodeforge:diagnostic-manager] TypeScript adapter failed", err);
      this.aggregator.clear("typescript");
    }
  }

  private async runEslint(root: string, signal: AbortSignal): Promise<void> {
    if (!this.adapters.eslint) return;
    try {
      const result = await this.adapters.eslint.run(root, signal);
      this.aggregator.record("eslint", result.diagnostics);
    } catch (err) {
      if (isAbortError(err)) {
        this.aggregator.clear("eslint");
        return;
      }
      // eslint-disable-next-line no-console
      console.error("[nodeforge:diagnostic-manager] ESLint adapter failed", err);
      this.aggregator.clear("eslint");
    }
  }

  private async runBiome(root: string, signal: AbortSignal): Promise<void> {
    if (!this.adapters.biome) return;
    try {
      const result = await this.adapters.biome.run(root, signal);
      this.aggregator.record("biome", result.diagnostics);
    } catch (err) {
      if (isAbortError(err)) {
        this.aggregator.clear("biome");
        return;
      }
      // eslint-disable-next-line no-console
      console.error("[nodeforge:diagnostic-manager] Biome adapter failed", err);
      this.aggregator.clear("biome");
    }
  }
}

function isAbortError(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: string }).code;
    return code === "ABORT_ERR" || code === "PROCESS_CANCELLED";
  }
  if (err instanceof Error && err.name === "AbortError") return true;
  if (err && typeof err === "object" && "code" in err) {
    return (err as { code?: string }).code === "PROCESS_CANCELLED";
  }
  return false;
}
