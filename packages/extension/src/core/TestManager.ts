/**
 * TestManager — orchestrates which test adapter runs for the current workspace.
 *
 * When a `WorkspaceProfile` arrives:
 *   testRunner === "vitest"  → use VitestAdapter
 *   testRunner === "jest"    → use JestAdapter
 *   testRunner === "node"    → NodeTestAdapter
 *   otherwise                → no test adapter
 *
 * The manager publishes `test.runCompleted` events on the bus so the
 * `TestsViewProvider` (and any other subscriber) can refresh.
 */

import type { EventBus, TestCase, TestRunResult, TestSuite, WorkspaceProfile } from "@nodeforge/contracts";
import { ProcessRunner } from "@nodeforge/runner";
import { VitestAdapter } from "@nodeforge/adapter-vitest";
import { JestAdapter } from "@nodeforge/adapter-jest";
import { NodeTestAdapter } from "@nodeforge/adapter-node-test";

export interface TestRunOutcome {
  suite: TestSuite;
  result: TestRunResult;
}

interface EnabledTestAdapter {
  kind: "vitest" | "jest" | "node";
  // We keep both adapters around as one-of; only the active one is invoked.
  // The shape makes it explicit that we run one type at a time.
  run: (root: string, signal?: AbortSignal, test?: TestCase) => Promise<TestRunOutcome>;
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
        run: async (root, signal, test) => {
          const result = await adapter.run(root, signal, test);
          return { suite: result.suite, result: result.result };
        }
      };
    } else if (profile.testRunner === "jest") {
      const adapter = new JestAdapter(this.runner);
      this.adapter = {
        kind: "jest",
        run: async (root, signal, test) => {
          const result = await adapter.run(root, signal, test);
          return { suite: result.suite, result: result.result };
        }
      };
    } else if (profile.testRunner === "node") {
      const adapter = new NodeTestAdapter(this.runner);
      this.adapter = {
        kind: "node",
        run: async (root, signal, test) => {
          const result = await adapter.run(root, signal, test);
          return { suite: result.suite, result: result.result };
        }
      };
    } else {
      this.adapter = undefined;
    }
  }

  /** Run the enabled test adapter. Cancels any in-flight run. */
  async run(testId?: string, externalSignal?: AbortSignal): Promise<TestRunOutcome | undefined> {
    const target = testId
      ? this.findTestTarget(this.lastOutcome?.suite, testId, [], true)
      : undefined;
    return this.runTarget(target, externalSignal);
  }

  private async runTarget(
    target: TestCase | undefined,
    externalSignal?: AbortSignal
  ): Promise<TestRunOutcome | undefined> {
    if (!this.profile || !this.adapter) {
      return undefined;
    }
    if (this.currentRun) {
      this.currentRun.abort();
    }

    const controller = new AbortController();
    this.currentRun = controller;
    const onExternalAbort = (): void => controller.abort();

    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }

    try {
      const outcome = await this.adapter.run(this.profile.root, controller.signal, target);
      this.lastOutcome = outcome;
      this.bus.publish({ type: "test.runCompleted", result: outcome.result });
      return outcome;
    } finally {
      if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
      if (this.currentRun === controller) {
        this.currentRun = undefined;
      }
    }
  }

  private findTestTarget(
    suite: TestSuite | undefined,
    testId: string,
    suitePath: string[],
    isRoot: boolean
  ): TestCase | undefined {
    if (!suite) return undefined;

    for (const test of suite.tests) {
      if (test.id === testId) return test;
    }

    for (const child of suite.suites) {
      const childIsFileSuite = isRoot;
      const childPath = childIsFileSuite ? [] : [...suitePath, child.name];

      if (child.id === testId && child.file) {
        return {
          id: child.id,
          name: child.name,
          file: child.file,
          fullName: childIsFileSuite ? undefined : childPath.join(" > "),
          status: "running"
        };
      }

      const found = this.findTestTarget(child, testId, childPath, false);
      if (found) return found;
    }

    return undefined;
  }

  /** Return the detected test runner for the current workspace. */
  getTestRunner(): EnabledTestAdapter["kind"] | undefined {
    return this.adapter?.kind;
  }

  /** Return the current workspace root used for test execution. */
  getWorkspaceRoot(): string | undefined {
    return this.profile?.root;
  }

  /** Run all tests contained in a single test file. */
  async runFile(filePath: string, externalSignal?: AbortSignal): Promise<TestRunOutcome | undefined> {
    const target: TestCase = {
      id: "file:" + filePath,
      name: filePath,
      file: filePath,
      status: "running"
    };
    return this.runTarget(target, externalSignal);
  }

  /** Cancel any in-flight run. */
  dispose(): void {
    if (this.currentRun) {
      this.currentRun.abort();
      this.currentRun = undefined;
    }
  }
}
