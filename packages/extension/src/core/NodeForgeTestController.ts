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
 * The controller creates native Run and Debug TestRunProfiles.
 *
 * On each run, the controller:
 *   1. Calls the TestManager to run the detected test runner (Vitest, Jest, or Node test)
 *   2. Maps the result back to TestItems by file path + test name
 *   3. Marks each TestItem as passed/failed/skipped
 *   4. Shows failure messages inline
 */

import * as vscode from "vscode";
import type { EventBus, TestCase, TestRunResult, TestSuite } from "@nodeforge/contracts";
import type { TestManager } from "./TestManager.js";
import { logger } from "./Logger.js";
import { buildTestDebugConfiguration, type TestRunnerKind } from "./testDebugConfiguration.js";

export class NodeForgeTestController {
  private readonly controller: vscode.TestController;
  private readonly runProfile: vscode.TestRunProfile;
  private readonly debugProfile: vscode.TestRunProfile;
  private readonly testCasesById = new Map<string, TestCase>();

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
      true
    );

    this.debugProfile = this.controller.createRunProfile(
      "NodeForge Debug",
      vscode.TestRunProfileKind.Debug,
      (request, token) => this.debugHandler(request, token),
      false
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

  private buildResultMap(result: TestRunResult): Map<string, TestCase> {
    return new Map((result.cases ?? []).map((test) => [test.id, test]));
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
    this.testCasesById.clear();

    for (const fileSuite of suite.suites) {
      const fileItem = this.controller.createTestItem(
        fileSuite.id,
        fileSuite.name,
        fileSuite.file ? vscode.Uri.file(fileSuite.file) : undefined
      );

      this.appendSuiteChildren(fileItem, fileSuite);

      for (const test of fileSuite.tests) {
        this.addTestItem(fileItem, test);
      }

      this.controller.items.add(fileItem);
    }

    for (const test of suite.tests) {
      this.addTestItem(this.controller as unknown as vscode.TestItem, test);
    }
  }

  private appendSuiteChildren(parentItem: vscode.TestItem, suite: TestSuite): void {
    for (const childSuite of suite.suites) {
      const suiteItem = this.controller.createTestItem(
        childSuite.id,
        childSuite.name,
        childSuite.file ? vscode.Uri.file(childSuite.file) : undefined
      );

      this.appendSuiteChildren(suiteItem, childSuite);

      for (const test of childSuite.tests) {
        this.addTestItem(suiteItem, test);
      }

      parentItem.children.add(suiteItem);
    }
  }

  private createTestItem(test: TestCase): vscode.TestItem {
    const testItem = this.controller.createTestItem(
      test.id,
      test.name,
      test.file ? vscode.Uri.file(test.file) : undefined
    );

    if (test.line) {
      testItem.range = new vscode.Range(
        new vscode.Position(test.line - 1, 0),
        new vscode.Position(test.line - 1, 100)
      );
    }

    return testItem;
  }

  private addTestItem(parentItem: vscode.TestItem, test: TestCase): void {
    this.testCasesById.set(test.id, test);
    parentItem.children.add(this.createTestItem(test));
  }

  private async debugHandler(
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken
  ): Promise<void> {
    const run = this.controller.createTestRun(request);
    const included = request.include ?? [];

    try {
      if (!isWorkspaceTrusted()) {
        const item = included[0];
        if (item) {
          run.errored(item, new vscode.TestMessage("Debugging tests requires Workspace Trust."));
        }
        return;
      }

      if (token.isCancellationRequested) return;

      if (included.length !== 1) {
        const item = included[0];
        if (item) {
          run.errored(
            item,
            new vscode.TestMessage("Select exactly one test or test file to debug.")
          );
        }
        return;
      }

      const item = included[0]!;
      if (request.exclude?.includes(item)) {
        return;
      }

      run.enqueued(item);

      const runner = this.testManager.getTestRunner() as TestRunnerKind | undefined;
      const workspaceRoot = this.testManager.getWorkspaceRoot();
      if (!runner || !workspaceRoot) {
        run.errored(item, new vscode.TestMessage("No supported test runner is detected."));
        return;
      }

      const test = this.testCasesById.get(item.id);
      const file = test?.file ?? item.uri?.fsPath;
      if (!file) {
        run.errored(item, new vscode.TestMessage("Unable to resolve the selected test file."));
        return;
      }

      const configuration = buildTestDebugConfiguration({
        runner,
        workspaceRoot,
        file,
        fullName: test?.fullName
      });

      const folder = vscode.workspace.getWorkspaceFolder(
        item.uri ?? vscode.Uri.file(workspaceRoot)
      );
      if (!folder) {
        run.errored(item, new vscode.TestMessage("Unable to resolve the VS Code workspace folder."));
        return;
      }

      const started = await vscode.debug.startDebugging(folder, configuration);
      if (!started) {
        run.errored(item, new vscode.TestMessage("VS Code did not start the test debugger."));
      }
    } catch (err) {
      logger.error("Test debug failed", err);
      const item = included[0];
      if (item) {
        run.errored(
          item,
          new vscode.TestMessage(err instanceof Error ? err.message : String(err))
        );
      }
    } finally {
      run.end();
    }
  }

  dispose(): void {
    this.controller.dispose();
  }
}
