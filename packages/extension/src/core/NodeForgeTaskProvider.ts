/**
 * NodeForgeTaskProvider — exposes package.json scripts as native VS Code Tasks.
 *
 * Users can run tasks via `Run Task...` / `Run Build Task...` instead of
 * dropping to the terminal. Tasks appear in the Tasks: Run Task list as
 * "npm: build", "npm: test", "npm: lint", etc.
 *
 * The provider reads package.json scripts and creates one Task per script.
 * Each task uses ShellExecution to run `<pm> run <script>` where <pm> is
 * the detected package manager (npm/pnpm/yarn).
 */

import * as vscode from "vscode";
import * as path from "node:path";
import { logger } from "./Logger.js";

interface PackageJson {
  scripts?: Record<string, string>;
}

export class NodeForgeTaskProvider implements vscode.TaskProvider {
  static taskType = "nodeforge";

  constructor(
    private readonly workspaceRoot: string,
    private readonly packageManager: "npm" | "pnpm" | "yarn"
  ) {}

  async provideTasks(): Promise<vscode.Task[]> {
    try {
      const pkg = await this.readPackageJson();
      if (!pkg.scripts) return [];

      const tasks: vscode.Task[] = [];
      const pm = this.packageManager;

      for (const [scriptName, scriptCommand] of Object.entries(pkg.scripts)) {
        // For yarn: `yarn <script>`. For npm/pnpm: `npm/pnpm run <script>`.
        const fullCommand = pm === "yarn"
          ? `yarn ${scriptName}`
          : `${pm} run ${scriptName}`;

        const task = new vscode.Task(
          { type: NodeForgeTaskProvider.taskType, script: scriptName },
          vscode.TaskScope.Workspace,
          `${pm}: ${scriptName}`,
          "NodeForge",
          new vscode.ShellExecution(fullCommand, { cwd: this.workspaceRoot }),
          undefined // problemMatchers — will be auto-detected by VS Code
        );

        task.detail = scriptCommand;
        tasks.push(task);
      }

      return tasks;
    } catch (err) {
      logger.error("Failed to provide tasks", err);
      return [];
    }
  }

  resolveTask(task: vscode.Task): vscode.Task | undefined {
    // Resolve a task definition to a concrete Task.
    const definition = task.definition as { type: string; script: string };
    if (definition.type !== NodeForgeTaskProvider.taskType) {
      return undefined;
    }

    const pm = this.packageManager;
    const fullCommand = pm === "yarn"
      ? `yarn ${definition.script}`
      : `${pm} run ${definition.script}`;

    return new vscode.Task(
      definition,
      vscode.TaskScope.Workspace,
      `${pm}: ${definition.script}`,
      "NodeForge",
      new vscode.ShellExecution(fullCommand, { cwd: this.workspaceRoot }),
      undefined
    );
  }

  private async readPackageJson(): Promise<PackageJson> {
    const fs = await import("node:fs/promises");
    const pkgPath = path.join(this.workspaceRoot, "package.json");
    const raw = await fs.readFile(pkgPath, "utf8");
    return JSON.parse(raw) as PackageJson;
  }

  /** Map common script names to VS Code's built-in problem matchers. */
  private matchProblemMatcher(_scriptName: string): string | undefined {
    return undefined; // VS Code auto-detects problem matchers
  }
}
