/**
 * NodeForge extension entry point.
 *
 * Activated on first `nodeforge.*` command or when the sidebar view is opened.
 * Wires together the detector, diagnostic manager, test manager, and VS Code UI.
 *
 * Workspace Trust model:
 *   - Restricted Mode: workspace inspection (detection) runs, but no
 *     adapters execute and no tests run. The sidebar shows the profile
 *     and an "Operation requires Workspace Trust" notice.
 *   - Trusted Mode: full functionality — adapters run on save, tests run
 *     on demand, runtime processes can be started.
 */

import * as vscode from "vscode";

import { InMemoryEventBus, NodeFilesystemReader, ProcessManager } from "@nodeforge/core";
import { ProcessRunner } from "@nodeforge/runner";
import { GitAdapter } from "@nodeforge/adapter-git";
import type { EventBus, GitState, WorkspaceProfile, DatabaseSchema, DependencyReport } from "@nodeforge/contracts";

import { WorkspaceViewProvider } from "./ui/WorkspaceViewProvider.js";
import { DiagnosticsViewProvider } from "./ui/DiagnosticsViewProvider.js";
import { TestsViewProvider } from "./ui/TestsViewProvider.js";
import { RuntimeViewProvider } from "./ui/RuntimeViewProvider.js";
import { GitViewProvider } from "./ui/GitViewProvider.js";
import { DatabaseViewProvider } from "./ui/DatabaseViewProvider.js";
import { DependencyViewProvider } from "./ui/DependencyViewProvider.js";
import { AgentViewProvider } from "./ui/AgentViewProvider.js";
import { WorkspaceManager } from "./core/WorkspaceManager.js";
import { DiagnosticManager } from "./core/DiagnosticManager.js";
import { TestManager } from "./core/TestManager.js";
import { DatabaseManager } from "./core/DatabaseManager.js";
import { DependencyManager } from "./core/DependencyManager.js";
import { DiagnosticsBridge } from "./core/DiagnosticsBridge.js";
import { logger } from "./core/Logger.js";

let workspaceManager: WorkspaceManager | undefined;
let diagnosticManager: DiagnosticManager | undefined;
let testManager: TestManager | undefined;
let processManager: ProcessManager | undefined;
let databaseManager: DatabaseManager | undefined;
let dependencyManager: DependencyManager | undefined;
let gitAdapter: GitAdapter | undefined;
let eventBus: EventBus | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  logger.info("NodeForge extension activating");

  const bus: EventBus = new InMemoryEventBus();
  eventBus = bus;
  const reader = new NodeFilesystemReader();
  const runner = new ProcessRunner();
  const manager = new WorkspaceManager(reader, runner, bus);
  workspaceManager = manager;
  const diagManager = new DiagnosticManager(reader, runner, bus);
  diagnosticManager = diagManager;
  const tests = new TestManager(runner, bus);
  testManager = tests;
  const procMgr = new ProcessManager(bus);
  processManager = procMgr;
  const dbManager = new DatabaseManager(bus);
  databaseManager = dbManager;
  const depManager = new DependencyManager(runner, bus);
  dependencyManager = depManager;
  const git = new GitAdapter(runner);
  gitAdapter = git;

  // Bridge diagnostics from the DiagnosticStore to VS Code's Problems panel.
  // This is the key integration that makes findings appear as squigglies in
  // the editor and entries in the Problems panel.
  const diagnosticsBridge = new DiagnosticsBridge(bus);

  // Register all sidebar views using createTreeView (not registerTreeDataProvider)
  // so we get reveal(), message, onDidChangeSelection, and visible.
  const workspaceView = new WorkspaceViewProvider(context, manager);
  const diagnosticsView = new DiagnosticsViewProvider(context, diagManager.getStore(), bus);
  const testsView = new TestsViewProvider(context, tests, bus);
  const runtimeView = new RuntimeViewProvider(context, procMgr, bus);
  const gitView = new GitViewProvider();
  const databaseView = new DatabaseViewProvider();
  const dependencyView = new DependencyViewProvider();
  const agentView = new AgentViewProvider(context);

  const treeViews: Record<string, vscode.TreeView<unknown>> = {
    workspace: vscode.window.createTreeView("nodeforge.workspace", { treeDataProvider: workspaceView }),
    diagnostics: vscode.window.createTreeView("nodeforge.diagnostics", { treeDataProvider: diagnosticsView }),
    tests: vscode.window.createTreeView("nodeforge.tests", { treeDataProvider: testsView }),
    runtime: vscode.window.createTreeView("nodeforge.runtime", { treeDataProvider: runtimeView }),
    git: vscode.window.createTreeView("nodeforge.git", { treeDataProvider: gitView }),
    database: vscode.window.createTreeView("nodeforge.database", { treeDataProvider: databaseView }),
    dependencies: vscode.window.createTreeView("nodeforge.dependencies", { treeDataProvider: dependencyView }),
    agent: vscode.window.createTreeView("nodeforge.agent", { treeDataProvider: agentView })
  };

  // Show a welcome message on the workspace view when no workspace is open.
  const root = resolveWorkspaceRoot();
  if (!root) {
    treeViews.workspace!.message = "Open a workspace folder to begin";
  }

  context.subscriptions.push(
    ...Object.values(treeViews),
    diagnosticsBridge,
    { dispose: () => logger.dispose() }
  );

  // ─── Commands ───

  context.subscriptions.push(
    // Internal: opens a file at line:col. Used by diagnostic + test tree click handlers.
    vscode.commands.registerCommand("nodeforge.openDiagnostic", async (file: string, line: number, col: number) => {
      try {
        const uri = vscode.Uri.file(file);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        const position = new vscode.Position(Math.max(0, line - 1), Math.max(0, col - 1));
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        editor.selection = new vscode.Selection(position, position);
      } catch (err) {
        logger.error(`Could not open ${file}`, err);
        void vscode.window.showWarningMessage(
          `NodeForge: could not open ${file} — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }),

    // Internal: stops a runtime process by id. Wired via view/item/context menu.
    vscode.commands.registerCommand("nodeforge.stopProcess", async (item: { processId?: string }) => {
      if (!item?.processId) return;
      const stopped = procMgr.stop(item.processId);
      if (stopped) {
        logger.info(`Stopped process ${item.processId}`);
      } else {
        void vscode.window.showWarningMessage("NodeForge: process not found or already stopped.");
      }
    }),

    // Internal: copies advisory URL to clipboard.
    vscode.commands.registerCommand("nodeforge.copyAdvisoryUrl", async (item: { detailValue?: string }) => {
      if (!item?.detailValue) return;
      await vscode.env.clipboard.writeText(item.detailValue);
      void vscode.window.showInformationMessage("Copied to clipboard");
    }),

    // Internal: opens advisory URL in browser.
    vscode.commands.registerCommand("nodeforge.openAdvisoryUrl", async (item: { detailValue?: string }) => {
      if (!item?.detailValue) return;
      const uri = vscode.Uri.parse(item.detailValue);
      await vscode.env.openExternal(uri);
    }),

    vscode.commands.registerCommand("nodeforge.analyzeWorkspace", async () => {
      const r = resolveWorkspaceRoot();
      if (!r) {
        void vscode.window.showWarningMessage("NodeForge: open a workspace folder before analyzing.");
        return;
      }
      try {
        const profile = await manager.analyze(r);
        workspaceView.render(profile);
        treeViews.workspace!.message = undefined;
        void vscode.window.showInformationMessage(formatProfileSummary(profile));
      } catch (err) {
        logger.error("Failed to analyze workspace", err);
        void vscode.window.showErrorMessage(
          `NodeForge: failed to analyze workspace — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }),

    vscode.commands.registerCommand("nodeforge.refresh", () => {
      workspaceView.refresh();
      diagnosticsView.refresh();
      testsView.refresh();
      runtimeView.refresh();
    }),

    vscode.commands.registerCommand("nodeforge.runDiagnostics", async () => {
      const r = resolveWorkspaceRoot();
      if (!r) {
        void vscode.window.showWarningMessage("NodeForge: open a workspace folder first.");
        return;
      }
      if (!isTrusted()) {
        void vscode.window.showWarningMessage("NodeForge: running diagnostics requires Workspace Trust.");
        return;
      }
      if (!manager.current()) {
        await manager.analyze(r);
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: "NodeForge: running diagnostics" },
        async () => {
          await diagManager.refresh();
        }
      );
      const counts = diagManager.getStore().counts();
      const total = counts.error + counts.warning + counts.info + counts.hint;
      void vscode.window.showInformationMessage(
        `NodeForge: ${total} finding${total === 1 ? "" : "s"} (${counts.error} error${counts.error === 1 ? "" : "s"}, ${counts.warning} warning${counts.warning === 1 ? "" : "s"})`
      );
    }),

    vscode.commands.registerCommand("nodeforge.runTests", async () => {
      const r = resolveWorkspaceRoot();
      if (!r) {
        void vscode.window.showWarningMessage("NodeForge: open a workspace folder first.");
        return;
      }
      if (!isTrusted()) {
        void vscode.window.showWarningMessage("NodeForge: running tests requires Workspace Trust.");
        return;
      }
      if (!manager.current()) {
        await manager.analyze(r);
      }
      if (!tests.isEnabled()) {
        void vscode.window.showWarningMessage(
          "NodeForge: no test runner detected (expected Vitest or Jest in dependencies)."
        );
        return;
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: "NodeForge: running tests" },
        async () => {
          await tests.run().catch((err) => {
            logger.error("Test run failed", err);
          });
        }
      );
      const outcome = tests.getCurrent();
      if (outcome) {
        const res = outcome.result;
        void vscode.window.showInformationMessage(
          `NodeForge: ${res.counts.passed} passed, ${res.counts.failed} failed, ${res.counts.skipped} skipped (${res.durationMs}ms)`
        );
      }
      testsView.refresh();
    }),

    vscode.commands.registerCommand("nodeforge.refreshGit", async () => {
      const r = resolveWorkspaceRoot();
      if (!r) return;
      try {
        const state = await git.detect(r);
        gitView.setState(state);
        if (state) {
          const parts: string[] = [`branch=${state.branch}`];
          parts.push(state.dirty ? "dirty" : "clean");
          if (state.upstream) parts.push(`+${state.ahead} -${state.behind}`);
          void vscode.window.showInformationMessage(`NodeForge: ${parts.join(", ")}`);
        } else {
          void vscode.window.showInformationMessage("NodeForge: not a git repository");
        }
      } catch (err) {
        logger.error("Git detection failed", err);
        void vscode.window.showErrorMessage(
          `NodeForge: git detection failed — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }),

    vscode.commands.registerCommand("nodeforge.detectDatabase", async () => {
      const r = resolveWorkspaceRoot();
      if (!r) return;
      if (!manager.current()) {
        await manager.analyze(r);
      }
      if (!dbManager.isEnabled()) {
        void vscode.window.showInformationMessage(
          "NodeForge: no ORM detected (expected Prisma or Drizzle)."
        );
        return;
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: "NodeForge: detecting database schema" },
        async () => {
          const schema = await dbManager.detect();
          databaseView.setSchema(schema);
          if (schema) {
            const relCount = schema.relations.length;
            void vscode.window.showInformationMessage(
              `NodeForge: ${schema.tables.length} table${schema.tables.length === 1 ? "" : "s"}${relCount > 0 ? `, ${relCount} relation${relCount === 1 ? "" : "s"}` : ""} (${schema.product})`
            );
          } else {
            void vscode.window.showWarningMessage("NodeForge: could not detect database schema.");
          }
        }
      );
    }),

    vscode.commands.registerCommand("nodeforge.auditDependencies", async () => {
      const r = resolveWorkspaceRoot();
      if (!r) return;
      if (!isTrusted()) {
        void vscode.window.showWarningMessage("NodeForge: running audits requires Workspace Trust.");
        return;
      }
      if (!manager.current()) {
        await manager.analyze(r);
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: "NodeForge: running dependency audit" },
        async () => {
          const report = await depManager.audit();
          dependencyView.setReport(report);
          if (report) {
            const parts: string[] = [];
            if (report.findings.length > 0) {
              parts.push(`${report.findings.length} vulnerabilit${report.findings.length === 1 ? "y" : "ies"}`);
            }
            if (report.outdated.length > 0) {
              parts.push(`${report.outdated.length} outdated`);
            }
            void vscode.window.showInformationMessage(
              parts.length > 0
                ? `NodeForge: ${parts.join(", ")}`
                : "NodeForge: dependencies up to date"
            );
          } else {
            void vscode.window.showWarningMessage("NodeForge: audit failed (no lockfile or no package manager).");
          }
        }
      );
    }),

    vscode.commands.registerCommand("nodeforge.showOutput", () => {
      logger.show();
    })
  );

  // ─── Listeners ───

  // Save → debounced diagnostic refresh (Trusted Mode only).
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      if (!isTrusted()) return;
      const profile = manager.current();
      if (!profile) return;
      const aggressive = vscode.workspace
        .getConfiguration("nodeforge.diagnostics")
        .get<boolean>("aggressiveRefresh", false);
      if (aggressive) {
        void diagManager.refresh().catch((err) => logger.error("Save-triggered diagnostic refresh failed", err));
      } else {
        diagManager.triggerOnSave();
      }
    })
  );

  // Configuration changes — react to nodeforge.* settings being modified.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("nodeforge.diagnostics")) {
        logger.info("Diagnostics configuration changed");
        // The aggressiveRefresh setting is read at save time, so no action
        // needed here — the next save will pick up the new value.
      }
      if (e.affectsConfiguration("nodeforge.runtime.preferredNodeBinary")) {
        logger.info("Preferred Node binary changed — will take effect on next adapter run");
        // The setting is read by ProcessRunner on each invocation, so no
        // immediate action is needed.
      }
    })
  );

  // Config-file watcher — re-runs detection when the workspace shape changes.
  // Note: we no longer skip sub-folder config files — monorepo support means
  // editing packages/foo/package.json should also trigger re-analysis.
  const watcher = vscode.workspace.createFileSystemWatcher(
    "**/{package.json,pnpm-workspace.yaml,tsconfig.json,eslint.config.*,.prettierrc*,biome.json,prisma/schema.prisma,drizzle.config.*,Dockerfile,docker-compose.*}"
  );
  context.subscriptions.push(watcher);
  const onConfigChange = async (uri: vscode.Uri): Promise<void> => {
    const r = resolveWorkspaceRoot();
    if (!r) return;
    try {
      const profile = await manager.analyze(r);
      workspaceView.render(profile);
      logger.info(`Re-analyzed workspace after config change: ${vscode.workspace.asRelativePath(uri, false)}`);
    } catch (err) {
      logger.error("Refresh on config change failed", err);
    }
  };
  context.subscriptions.push(watcher.onDidChange(onConfigChange));
  context.subscriptions.push(watcher.onDidCreate(onConfigChange));
  context.subscriptions.push(watcher.onDidDelete(onConfigChange));

  // Dispose managers when the extension is deactivated.
  context.subscriptions.push(
    { dispose: () => diagManager.dispose() },
    { dispose: () => tests.dispose() },
    { dispose: () => procMgr.dispose() }
  );

  // ─── Auto-run on activation ───

  if (root && isTrusted()) {
    logger.info(`Auto-running for workspace: ${root}`);
    void manager.analyze(root).then(
      (profile) => {
        workspaceView.render(profile);
        treeViews.workspace!.message = undefined;
        void diagManager.refresh().catch((err) => {
          logger.error("Initial diagnostic run failed", err);
        });
        void git.detect(root).then(
          (state) => gitView.setState(state),
          (err) => logger.error("Initial git detect failed", err)
        );
        if (dbManager.isEnabled()) {
          void dbManager.detect().then(
            (schema) => databaseView.setSchema(schema),
            (err) => logger.error("Initial database detect failed", err)
          );
        }
      },
      (err) => {
        logger.error("Initial analyze failed", err);
      }
    );
  }

  logger.info("NodeForge extension activated");
}

export function deactivate(): void {
  logger.info("NodeForge extension deactivating");
  workspaceManager = undefined;
  diagnosticManager = undefined;
  testManager = undefined;
  processManager = undefined;
  databaseManager = undefined;
  dependencyManager = undefined;
  gitAdapter = undefined;
  eventBus = undefined;
}

function isTrusted(): boolean {
  // isWorkspaceTrusted is stable since VS Code 1.83 but not yet in @types/vscode.
  const ws = vscode.workspace as typeof vscode.workspace & { isWorkspaceTrusted?: boolean };
  return typeof ws.isWorkspaceTrusted === "boolean" ? ws.isWorkspaceTrusted : true;
}

function resolveWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;
  const first = folders[0];
  return first ? first.uri.fsPath : undefined;
}

function formatProfileSummary(p: WorkspaceProfile): string {
  const parts: string[] = [];
  parts.push(`runtime=${p.runtime}`);
  parts.push(`pm=${p.packageManager}`);
  parts.push(`ts=${p.typescript ? "yes" : "no"}`);
  if (p.linter) parts.push(`linter=${p.linter}`);
  if (p.formatter) parts.push(`fmt=${p.formatter}`);
  if (p.testRunner && p.testRunner !== "unknown") parts.push(`test=${p.testRunner}`);
  if (p.orm) parts.push(`orm=${p.orm}`);
  if (p.docker) parts.push("docker");
  if (p.githubActions) parts.push("gha");
  if (p.monorepo !== "none") parts.push(`mono=${p.monorepo}`);
  return `NodeForge: ${parts.join(", ")}`;
}

// Exported for integration tests.
export {
  workspaceManager,
  diagnosticManager,
  testManager,
  processManager,
  databaseManager,
  dependencyManager,
  gitAdapter,
  eventBus
};
export type { EventBus, GitState, DatabaseSchema, DependencyReport };
