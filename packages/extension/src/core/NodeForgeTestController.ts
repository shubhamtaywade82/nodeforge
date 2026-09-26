/**
 * NodeForgeTestController — native VS Code Test Explorer integration.
 *
 * Replaces the ad-hoc TestsViewProvider tree with the native Test Controller
 * API. This unlocks:
 *   - Gutter glyphs (green check / red X / grey dash) next to each test
 *   - "Run Test" / "Debug Test" code lenses above it()/test() calls
 *   - Per-test status icons in the Test Explorer panel
 *   - Continuous Testing mode
 *   - Native test result navigation
 *
 * The controller creates a TestRunProfile for "run" mode. Debug mode is
 * declared but requires a debug adapter to be useful (future work).
 *
 * On each run, the controller:
 *   1. Calls the TestManager to run Vitest/Jest
 *   2. Maps the result back to TestItems by file path + test name
 *   3. Marks each TestItem as passed/failed/skipped
 *   4. Shows failure messages inline
 */

import * as vscode from "vscode";
import type { EventBus, TestCase, TestRunResult, TestSuite } from "@nodeforge/contracts";
import type { TestManager } from "./TestManager.js";
import { logger } from "./Logger.js";

export class NodeForgeTestController {
  private readonly controller: vscode.TestController;
  private readonly runProfile: vscode.TestRunProfile;

  constructor(
    private readonly testManager: TestManager,
    bus: EventBus
  ) {
    this.controller = vscode.tests.createTestController(
      "nodeforge-tests",
      "NodeForge Tests"
    );

    // Create the "Run" profile (not debug — debug requires a debug adapter).
    this.runProfile = this.controller.createRunProfile(
      "NodeForge Run",
      vscode.TestRunProfileKind.Run,
      (request, token) => this.runHandler(request, token),
      true // isDefault
    );

    // Discover tests on controller creation (lazy — VS Code calls refresh).
    this.controller.refreshHandler = async () => {
      await this.discoverTests();
    };
  }

  /** Discover tests by running the TestManager and building the test tree. */
  async discoverTests(): Promise<void> {
    if (!this.testManager.isEnabled()) {
      return;
    }

    try {
      // Run the tests to discover them (we could use a --list mode in the
      // future, but for now running is the most reliable discovery method).
      const outcome = await this.testManager.run();
      if (!outcome) return;

      this.buildTestTree(outcome.suite);
    } catch (err) {
      logger.error("Test discovery failed", err);
    }
  }

  /** Run handler called by VS Code when the user clicks Run Test. */
  private async runHandler(
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken
  ): Promise<void> {
    const run = this.controller.createTestRun(request);
    const included = request.include ?? this.collectLeafTests(this.controller.items);
    const targetTest =
      request.include?.length === 1 &&
      request.include[0] &&
      request.include[0].children.size === 0
        ? request.include[0]
        : undefined;

    for (const item of included) {
      if (!request.exclude?.includes(item)) run.enqueued(item);
    }

    const controller = new AbortController();
    const cancellation = token.onCancellationRequested(() => controller.abort());

    try {
      const outcome = await this.testManager.run(targetTest?.id, controller.signal);
      if (!outcome) {
        const first = targetTest ?? included[0];
        if (first) run.errored(first, new vscode.TestMessage("No test runner detected"));
        return;
      }

      const resultMap = this.buildResultMap(outcome.result);
      const selectedLeaves = request.include
        ? request.include.flatMap((item) =>
            item.children.size === 0 ? [item] : this.collectLeafTests(item.children)
          )
        : this.collectLeafTests(this.controller.items);

      for (const item of selectedLeaves) {
        if (request.exclude?.includes(item)) continue;
        const test = resultMap.get(item.id);
        if (!test) continue;

        switch (test.status) {
          case "passed":
            run.passed(item, test.durationMs);
            break;
          case "failed":
            run.failed(
              item,
              new vscode.TestMessage(test.error?.message ?? "Test failed"),
              test.durationMs
            );
            break;
          case "skipped":
          case "todo":
            run.skipped(item);
            break;
          case "errored":
            run.errored(item, new vscode.TestMessage(test.error?.message ?? "Test errored"));
            break;
          default:
            break;
        }
      }
    } catch (err) {
      logger.error("Test run failed", err);
      const first = targetTest ?? included[0];
      if (first) {
        run.errored(
          first,
          new vscode.TestMessage(err instanceof Error ? err.message : String(err))
        );
      }
    } finally {
      cancellation.dispose();
      run.end();
    }
  }

  private collectLeafTests(collection: vscode.TestItemCollection): vscode.TestItem[] {
    const out: vscode.TestItem[] = [];
    const visit = (items: vscode.TestItemCollection): void => {
      items.forEach((item) => {
        if (item.children.size === 0) out.push(item);
        else visit(item.children);
      });
    };
    visit(collection);
    return out;
  }

  /** Build the test tree from a TestSuite. */
  private buildTestTree(suite: TestSuite): void {
    this.controller.items.replace([]);

    for (const fileSuite of suite.suites) {
      const fileItem = this.controller.createTestItem(
        fileSuite.id,
        fileSuite.name,
        fileSuite.file ? vscode.Uri.file(fileSuite.file) : undefined
      );

      // Add describe-block children.
      for (const describeSuite of fileSuite.suites) {
        const describeItem = this.controller.createTestItem(
          describeSuite.id,
          describeSuite.name,
          fileSuite.file ? vscode.Uri.file(fileSuite.file) : undefined
        );
        for (const test of describeSuite.tests) {
          const testItem = this.controller.createTestItem(
            test.id,
            test.name,
            fileSuite.file ? vscode.Uri.file(fileSuite.file) : undefined
          );
          if (test.line) {
            testItem.range = new vscode.Range(
              new vscode.Position(test.line - 1, 0),
              new vscode.Position(test.line - 1, 100)
            );
          }
          describeItem.children.add(testItem);
        }
        fileItem.children.add(describeItem);
      }

      // Add top-level tests (not inside a describe block).
      for (const test of fileSuite.tests) {
        const testItem = this.controller.createTestItem(
          test.id,
          test.name,
          fileSuite.file ? vscode.Uri.file(fileSuite.file) : undefined
        );
        if (test.line) {
          testItem.range = new vscode.Range(
            new vscode.Position(test.line - 1, 0),
            new vscode.Position(test.line - 1, 100)
          );
        }
        fileItem.children.add(testItem);
      }

      this.controller.items.add(fileItem);
    }
  }

  dispose(): void {
    this.controller.dispose();
  }
}
