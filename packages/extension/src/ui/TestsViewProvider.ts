/**
 * Tests sidebar — renders the latest test run outcome as a tree.
 *
 *   Tests
 *   ├─ vitest  (5 passed, 1 failed)
 *   │   └─ math.test.ts
 *   │       ├─ add
 *   │       │   ├─ ✓ adds two positive numbers (1ms)
 *   │       │   ├─ ✓ handles negative numbers
 *   │       │   └─ ✓ handles zero
 *   │       └─ divide
 *   │           ├─ ✓ divides correctly
 *   │           ├─ ✓ throws on division by zero
 *   │           └─ ✗ intentionally failing assertion
 *   │               Expected 3, received 2
 *
 * Subscribes to `test.runCompleted` events so the tree refreshes whenever
 * a test run finishes.
 */

import * as vscode from "vscode";
import * as path from "node:path";
import type { EventBus, TestCase, TestRunResult, TestSuite } from "@nodeforge/contracts";
import type { TestManager } from "../core/TestManager.js";

type NodeKind = "root" | "file" | "suite" | "test" | "empty";

interface TreeNode {
  kind: NodeKind;
  label: string;
  description?: string;
  tooltip?: string;
  /** Underlying test id (for test nodes) or suite id (for suite/file nodes). */
  testId?: string;
  file?: string;
  line?: number;
  /** Icon hint — we map these to ThemeIcon in getTreeItem. */
  icon?: "pass" | "fail" | "skip" | "info" | "folder";
}

export class TestsViewProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  private outcome: { suite: TestSuite; result: TestRunResult } | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly manager: TestManager,
    bus: EventBus
  ) {
    bus.subscribe("test.runCompleted", (e) => {
      // Refresh from the manager so we have the full suite tree, not just the result summary.
      const current = manager.getCurrent();
      if (current) {
        this.outcome = current;
        this.emitter.fire(undefined);
      } else {
        // Fallback — at least reflect the run summary.
        void e;
      }
    });
  }

  refresh(): void {
    this.outcome = this.manager.getCurrent();
    this.emitter.fire(undefined);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label);
    item.description = element.description ?? "";
    if (element.tooltip) item.tooltip = element.tooltip;
    item.iconPath = iconFor(element);
    if (element.kind === "root" || element.kind === "file" || element.kind === "suite") {
      item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
      item.contextValue = element.kind;
    } else {
      item.collapsibleState = vscode.TreeItemCollapsibleState.None;
      item.contextValue = "test";
      if (element.file) {
        item.command = {
          command: "nodeforge.openDiagnostic",
          title: "Open Test",
          arguments: [element.file, element.line ?? 1, 1]
        };
      }
    }
    return item;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!this.outcome) {
      if (!element) {
        return [
          {
            kind: "empty",
            label: "No tests run yet",
            description: "Click 'Run Tests' to execute",
            tooltip: "Run the 'NodeForge: Run Tests' command",
            icon: "info"
          }
        ];
      }
      return [];
    }

    if (!element) {
      // Top: a root node describing the run, with the file suites as children.
      const r = this.outcome.result;
      const parts: string[] = [];
      if (r.counts.passed > 0) parts.push(`${r.counts.passed} passed`);
      if (r.counts.failed > 0) parts.push(`${r.counts.failed} failed`);
      if (r.counts.skipped > 0) parts.push(`${r.counts.skipped} skipped`);
      const summary = parts.join(", ");
      return [
        {
          kind: "root",
          label: this.outcome.suite.name,
          description: summary,
          tooltip: `Test run: ${summary}\nDuration: ${r.durationMs}ms`,
          icon: r.counts.failed > 0 ? "fail" : "pass"
        }
      ];
    }

    if (element.kind === "root") {
      return this.outcome.suite.suites.map((s) => toSuiteNode(s));
    }

    if (element.kind === "file" || element.kind === "suite") {
      const suite = findSuite(this.outcome.suite, element.testId);
      if (!suite) return [];
      const childSuites = suite.suites.map((s) => toSuiteNode(s));
      const childTests = suite.tests.map((t) => toTestNode(t));
      return [...childSuites, ...childTests];
    }

    return [];
  }
}

function toSuiteNode(suite: TestSuite): TreeNode {
  const label = suite.name;
  const fileName = suite.file ? path.basename(suite.file) : label;
  return {
    kind: suite.file && suite.name !== "vitest" && suite.name !== "jest" ? "file" : "suite",
    label,
    description: fileName === label ? "" : fileName,
    tooltip: suite.file ? `File: ${suite.file}` : label,
    testId: suite.id,
    file: suite.file,
    icon: "folder"
  };
}

function toTestNode(test: TestCase): TreeNode {
  const icon = test.status === "passed" ? "pass" : test.status === "failed" ? "fail" : "skip";
  const desc =
    test.durationMs !== undefined
      ? `${test.durationMs}ms`
      : test.status === "skipped"
        ? "skipped"
        : "";
  const tooltip =
    test.error?.message ?? `${test.name} — ${test.status}`;
  return {
    kind: "test",
    label: test.name,
    description: desc,
    tooltip,
    testId: test.id,
    file: test.file,
    line: test.line,
    icon
  };
}

function findSuite(root: TestSuite, id: string | undefined): TestSuite | undefined {
  if (!id) return undefined;
  if (root.id === id) return root;
  for (const s of root.suites) {
    const found = findSuite(s, id);
    if (found) return found;
  }
  return undefined;
}

function iconFor(element: TreeNode): vscode.ThemeIcon {
  switch (element.icon) {
    case "pass":
      return new vscode.ThemeIcon("check", new vscode.ThemeColor("testing.iconPassed"));
    case "fail":
      return new vscode.ThemeIcon("x", new vscode.ThemeColor("testing.iconFailed"));
    case "skip":
      return new vscode.ThemeIcon("circle-slash", new vscode.ThemeColor("testing.iconSkipped"));
    case "info":
      return new vscode.ThemeIcon("info");
    case "folder":
      return new vscode.ThemeIcon("folder");
    default:
      return new vscode.ThemeIcon("symbol-method");
  }
}
