/**
 * TestManager — orchestrates which test adapter runs for the current workspace.
 *
 * When a `WorkspaceProfile` arrives:
 *   testRunner === "vitest"  → use VitestAdapter
 *   testRunner === "jest"    → use JestAdapter
 *   testRunner === "node"    → not yet supported (placeholder)
 *   otherwise                → no test adapter
 *
 * The manager publishes `test.runCompleted` events on the bus so the
 * `TestsViewProvider` (and any other subscriber) can refresh.
 */

import type { EventBus, TestRunResult, TestSuite, WorkspaceProfile } from "@nodeforge/contracts";
import { ProcessRunner } from "@nodeforge/runner";
import { VitestAdapter } from "@nodeforge/adapter-vitest";
import { JestAdapter } from "@nodeforge/adapter-jest";

export interface TestRunOutcome {
  suite: TestSuite;
  result: TestRunResult;
}

interface EnabledTestAdapter {
  kind: "vitest" | "jest";
  // We keep both adapters around as one-of; only the active one is invoked.
  // The shape makes it explicit that we run one type at a time.
  run: (root: string, signal?: AbortSignal) => Promise<TestRunOutcome>;
}

export class TestManager {
  private profile: WorkspaceProfile | undefined;
  private adapter: EnabledTestAdapter | undefined;
  private currentRun: AbortController | undefined;
  private lastOutcome: TestRunOutcome | undefined;

  constructor(
    private readonly runner: ProcessRunner,
    private readonly bus: EventBus
  ) {
    this.bus.subscribe("workspace.profiled", (e) => {
      this.onProfileChanged(e.profile);
    });
  }

  /** Returns the last completed test run outcome, if any. */
  getCurrent(): TestRunOutcome | undefined {
    return this.lastOutcome;
  }

  /** Returns true if a test adapter is enabled for the current profile. */
  isEnabled(): boolean {
    return this.adapter !== undefined;
  }

  /** Update the cached profile and reconfigure the test adapter. */
  onProfileChanged(profile: WorkspaceProfile): void {
    this.profile = profile;
    if (profile.testRunner === "vitest") {
      const adapter = new VitestAdapter(this.runner);
      this.adapter = {
        kind: "vitest",
        run: async (root, signal) => {
          const result = await adapter.run(root, signal);
          return { suite: result.suite, result: result.result };
        }
      };
    } else if (profile.testRunner === "jest") {
      const adapter = new JestAdapter(this.runner);
      this.adapter = {
        kind: "jest",
        run: async (root, signal) => {
          const result = await adapter.run(root, signal);
          return { suite: result.suite, result: result.result };
        }
      };
    } else {
      this.adapter = undefined;
    }
  }

  /** Run the enabled test adapter. Cancels any in-flight run. */
  async run(): Promise<TestRunOutcome | undefined> {
    if (!this.profile || !this.adapter) {
      return undefined;
    }
    if (this.currentRun) {
      this.currentRun.abort();
    }
    const controller = new AbortController();
    this.currentRun = controller;

    try {
      const outcome = await this.adapter.run(this.profile.root, controller.signal);
      this.lastOutcome = outcome;
      this.bus.publish({ type: "test.runCompleted", result: outcome.result });
      return outcome;
    } finally {
      if (this.currentRun === controller) {
        this.currentRun = undefined;
      }
    }
  }

  /** Cancel any in-flight run. */
  dispose(): void {
    if (this.currentRun) {
      this.currentRun.abort();
      this.currentRun = undefined;
    }
  }
}
