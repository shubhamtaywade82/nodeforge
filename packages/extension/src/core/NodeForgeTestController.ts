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
import * as path from "node:path";
import type { EventBus, TestRunResult, TestSuite, TestCase } from "@nodeforge/contracts";
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

    // Refresh test tree when a test run completes.
    bus.subscribe("test.runCompleted", (e) => {
      this.applyResults(e.result);
    });

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
      this.applyResults(outcome.result);
    } catch (err) {
      logger.error("Test discovery failed", err);
    }
  }

  /** Run handler called by VS Code when the user clicks Run Test. */
  private async runHandler(
    request: vscode.TestRunRequest,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const run = this.controller.createTestRun(request);

    try {
      // Mark tests as enqueued.
      if (request.include) {
        for (const t of request.include) {
          run.enqueued(t);
        }
      }

      // Run all tests (per-test run is future work — requires passing a
      // test name filter to the adapter).
      const outcome = await this.testManager.run();
      if (!outcome) {
        const firstTest = request.include?.[0];
        if (firstTest) {
          run.errored(firstTest, new vscode.TestMessage("No test runner detected"));
        }
        run.end();
        return;
      }

      // Map results back to TestItems.
      const resultMap = this.buildResultMap(outcome.result);
      const allTests = this.collectAllTestItems(this.controller.items);

      for (const item of allTests) {
        const result = resultMap.get(item.id);
        if (result === "passed") {
          run.passed(item);
        } else if (result === "failed") {
          run.failed(item, new vscode.TestMessage(this.getFailureMessage(item.id)));
        } else if (result === "skipped") {
          run.skipped(item);
        }
      }

      run.end();
    } catch (err) {
      logger.error("Test run failed", err);
      run.end();
    }
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

  /** Apply test results to the existing TestItems. */
  private applyResults(result: TestRunResult): void {
    const resultMap = this.buildResultMap(result);
    const allTests = this.collectAllTestItems(this.controller.items);

    for (const item of allTests) {
      const status = resultMap.get(item.id);
      if (status === "passed") {
        item.label = `$(check) ${item.label.replace(/^\$\([^)]+\)\s*/, "")}`;
      } else if (status === "failed") {
        item.label = `$(x) ${item.label.replace(/^\$\([^)]+\)\s*/, "")}`;
      }
    }
  }

  /** Build a map of testId → status from a TestRunResult. */
  private buildResultMap(result: TestRunResult): Map<string, string> {
    // The TestRunResult has counts but not per-test results in the current
    // contract. We'd need to enhance the contract to include per-test
    // outcomes. For now, we mark all tests as "passed" if the overall
    // run passed, and "failed" if any failed.
    //
    // TODO: Enhance the TestRunResult contract to include per-test outcomes.
    const map = new Map<string, string>();
    const allTests = this.collectAllTestItems(this.controller.items);
    for (const item of allTests) {
      map.set(item.id, result.counts.failed > 0 ? "failed" : "passed");
    }
    return map;
  }

  /** Recursively collect all TestItems from a TestItemCollection. */
  private collectAllTestItems(collection: vscode.TestItemCollection): vscode.TestItem[] {
    const items: vscode.TestItem[] = [];
    const visit = (coll: vscode.TestItemCollection): void => {
      coll.forEach((item) => {
        items.push(item);
        visit(item.children);
      });
    };
    visit(collection);
    return items;
  }

  /** Get the failure message for a test by id. */
  private getFailureMessage(testId: string): string {
    // TODO: Look up the actual failure message from the test result.
    // For now, return a generic message.
    return `Test failed: ${testId}`;
  }

  dispose(): void {
    this.controller.dispose();
  }
}
