/**
 * StatusBarController — always-visible status bar showing diagnostic counts,
 * test status, and git branch.
 *
 * Creates a single StatusBarItem aligned to the left, near the language
 * status indicator. Updates reactively when:
 *   - Diagnostics change (via bus subscription)
 *   - Tests complete (via bus subscription)
 *   - Git state changes (via setGitState())
 *
 * Format: `$(error-circle) 3  $(warning) 5  $(check) 12  ·  main +1`
 */

import * as vscode from "vscode";
import type { EventBus } from "@nodeforge/contracts";
import type { GitState } from "@nodeforge/contracts";
import { logger } from "./Logger.js";

export class StatusBarController {
  private readonly item: vscode.StatusBarItem;
  private errorCount = 0;
  private warningCount = 0;
  private testPassCount = 0;
  private testFailCount = 0;
  private gitBranch: string | undefined;
  private gitAheadBehind: string | undefined;

  constructor(bus: EventBus) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      50 // priority — appears after language status but before git
    );
    this.item.command = "nodeforge.runDiagnostics";
    this.item.tooltip = "NodeForge: Click to run diagnostics";

    // Subscribe to diagnostic snapshots
    bus.subscribe("diagnostics.snapshot", (e) => {
      this.errorCount = e.snapshot.counts.error;
      this.warningCount = e.snapshot.counts.warning;
      this.update();
    });

    // Subscribe to test run completions
    bus.subscribe("test.runCompleted", (e) => {
      this.testPassCount = e.result.counts.passed;
      this.testFailCount = e.result.counts.failed;
      this.update();
    });

    this.update();
  }

  /** Update the git state shown in the status bar. */
  setGitState(state: GitState | undefined): void {
    if (state) {
      this.gitBranch = state.branch;
      this.gitAheadBehind = state.ahead > 0 || state.behind > 0
        ? `+${state.ahead} -${state.behind}`
        : undefined;
    } else {
      this.gitBranch = undefined;
      this.gitAheadBehind = undefined;
    }
    this.update();
  }

  private update(): void {
    const parts: string[] = [];

    // Diagnostics
    if (this.errorCount > 0) {
      parts.push(`$(error) ${this.errorCount}`);
    }
    if (this.warningCount > 0) {
      parts.push(`$(warning) ${this.warningCount}`);
    }
    if (this.errorCount === 0 && this.warningCount === 0) {
      parts.push("$(check) 0");
    }

    // Tests (only show if tests have been run)
    if (this.testPassCount > 0 || this.testFailCount > 0) {
      if (this.testFailCount > 0) {
        parts.push(`$(x) ${this.testFailCount}`);
      }
      parts.push(`$(check) ${this.testPassCount}`);
    }

    // Git
    if (this.gitBranch) {
      let gitPart = `$(git-branch) ${this.gitBranch}`;
      if (this.gitAheadBehind) {
        gitPart += ` ${this.gitAheadBehind}`;
      }
      parts.push(gitPart);
    }

    this.item.text = parts.join("  ");
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
