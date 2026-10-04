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
import { classifyScript, scriptInvocation, type PackageManager } from "./taskMeta.js";

interface PackageJson {
  scripts?: Record<string, string>;
}

export class NodeForgeTaskProvider implements vscode.TaskProvider {
  static taskType = "nodeforge";

  constructor(
    private readonly workspaceRoot: string,
    private packageManager: PackageManager
  ) {}

  setPackageManager(packageManager: PackageManager): void {
    this.packageManager = packageManager;
  }

  async provideTasks(): Promise<vscode.Task[]> {
    try {
      const pkg = await this.readPackageJson();
      if (!pkg.scripts) return [];

      return Object.entries(pkg.scripts).map(([scriptName, scriptCommand]) =>
        this.createTask({ type: NodeForgeTaskProvider.taskType, script: scriptName }, scriptName, scriptCommand)
      );
    } catch (err) {
      logger.error("Failed to provide tasks", err);
      return [];
    }
  }

  async resolveTask(task: vscode.Task): Promise<vscode.Task | undefined> {
    const definition = task.definition as { type: string; script?: string };
    if (definition.type !== NodeForgeTaskProvider.taskType || !definition.script) {
      return undefined;
    }
    let command = "";
    try {
      command = (await this.readPackageJson()).scripts?.[definition.script] ?? "";
    } catch (err) {
      logger.warn(`Could not read package.json while resolving task: ${String(err)}`);
    }
    return this.createTask(definition, definition.script, command);
  }

  private createTask(
    definition: vscode.TaskDefinition,
    scriptName: string,
    scriptCommand: string
  ): vscode.Task {
    const pm = this.packageManager;
    const meta = classifyScript(scriptName, scriptCommand);
    const invocation = scriptInvocation(pm, scriptName);
    const task = new vscode.Task(
      definition,
      vscode.TaskScope.Workspace,
      `${pm}: ${scriptName}`,
      "NodeForge",
      new vscode.ProcessExecution(invocation.command, invocation.args, { cwd: this.workspaceRoot }),
      meta.problemMatchers
    );
    if (scriptCommand) task.detail = scriptCommand;
    task.isBackground = meta.isBackground;
    // TaskGroup.isDefault is read-only, so the default build/test task is chosen by the user.
    if (meta.group === "build") task.group = vscode.TaskGroup.Build;
    else if (meta.group === "test") task.group = vscode.TaskGroup.Test;
    else if (meta.group === "clean") task.group = vscode.TaskGroup.Clean;
    return task;
  }

  private async readPackageJson(): Promise<PackageJson> {
    const fs = await import("node:fs/promises");
    const pkgPath = path.join(this.workspaceRoot, "package.json");
    const raw = await fs.readFile(pkgPath, "utf8");
    return JSON.parse(raw) as PackageJson;
  }
}
