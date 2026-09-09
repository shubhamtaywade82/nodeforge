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

let workspaceManager: WorkspaceManager | undefined;
let diagnosticManager: DiagnosticManager | undefined;
let testManager: TestManager | undefined;
let processManager: ProcessManager | undefined;
let databaseManager: DatabaseManager | undefined;
let dependencyManager: DependencyManager | undefined;
let gitAdapter: GitAdapter | undefined;
let eventBus: EventBus | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
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

  // Wire sidebar views.
  const workspaceView = new WorkspaceViewProvider(context, manager);
  const diagnosticsView = new DiagnosticsViewProvider(context, diagManager.getStore(), bus);
  const testsView = new TestsViewProvider(context, tests, bus);
  const runtimeView = new RuntimeViewProvider(context, procMgr, bus);
  const gitView = new GitViewProvider();
  const databaseView = new DatabaseViewProvider();
  const dependencyView = new DependencyViewProvider();
  const agentView = new AgentViewProvider(context);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("nodeforge.workspace", workspaceView),
    vscode.window.registerTreeDataProvider("nodeforge.diagnostics", diagnosticsView),
    vscode.window.registerTreeDataProvider("nodeforge.tests", testsView),
    vscode.window.registerTreeDataProvider("nodeforge.runtime", runtimeView),
    vscode.window.registerTreeDataProvider("nodeforge.git", gitView),
    vscode.window.registerTreeDataProvider("nodeforge.database", databaseView),
    vscode.window.registerTreeDataProvider("nodeforge.dependencies", dependencyView),
    vscode.window.registerTreeDataProvider("nodeforge.agent", agentView)
  );

  // Internal command — opens a file at a line/col. Used by diagnostic + test
  // tree click handlers. We register it under a non-user-facing id.
  context.subscriptions.push(
    vscode.commands.registerCommand("nodeforge.openDiagnostic", async (file: string, line: number, col: number) => {
      try {
        const uri = vscode.Uri.file(file);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc);
        const position = new vscode.Position(Math.max(0, line - 1), Math.max(0, col - 1));
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        editor.selection = new vscode.Selection(position, position);
      } catch (err) {
        void vscode.window.showWarningMessage(
          `NodeForge: could not open ${file} — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })
  );

  // Commands.
  context.subscriptions.push(
    vscode.commands.registerCommand("nodeforge.analyzeWorkspace", async () => {
      const root = resolveWorkspaceRoot();
      if (!root) {
        void vscode.window.showWarningMessage("NodeForge: open a workspace folder before analyzing.");
        return;
      }
      try {
        const profile = await manager.analyze(root);
        workspaceView.render(profile);
        void vscode.window.showInformationMessage(formatProfileSummary(profile));
      } catch (err) {
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
      const root = resolveWorkspaceRoot();
      if (!root) {
        void vscode.window.showWarningMessage("NodeForge: open a workspace folder first.");
        return;
      }
      if (!(await isWorkspaceTrusted())) {
        void vscode.window.showWarningMessage("NodeForge: running diagnostics requires Workspace Trust.");
        return;
      }
      // Make sure the profile is fresh before deciding which adapters to run.
      if (!manager.current()) {
        await manager.analyze(root);
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
      const root = resolveWorkspaceRoot();
      if (!root) {
        void vscode.window.showWarningMessage("NodeForge: open a workspace folder first.");
        return;
      }
      if (!(await isWorkspaceTrusted())) {
        void vscode.window.showWarningMessage("NodeForge: running tests requires Workspace Trust.");
        return;
      }
      if (!manager.current()) {
        await manager.analyze(root);
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
            // eslint-disable-next-line no-console
            console.error("[nodeforge] test run failed", err);
          });
        }
      );
      const outcome = tests.getCurrent();
      if (outcome) {
        const r = outcome.result;
        void vscode.window.showInformationMessage(
          `NodeForge: ${r.counts.passed} passed, ${r.counts.failed} failed, ${r.counts.skipped} skipped (${r.durationMs}ms)`
        );
      }
      testsView.refresh();
    }),
    vscode.commands.registerCommand("nodeforge.refreshGit", async () => {
      const root = resolveWorkspaceRoot();
      if (!root) return;
      try {
        const state = await git.detect(root);
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
        void vscode.window.showErrorMessage(
          `NodeForge: git detection failed — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }),
    vscode.commands.registerCommand("nodeforge.detectDatabase", async () => {
      const root = resolveWorkspaceRoot();
      if (!root) return;
      if (!manager.current()) {
        await manager.analyze(root);
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
      const root = resolveWorkspaceRoot();
      if (!root) return;
      if (!(await isWorkspaceTrusted())) {
        void vscode.window.showWarningMessage("NodeForge: running audits requires Workspace Trust.");
        return;
      }
      if (!manager.current()) {
        await manager.analyze(root);
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
    })
  );

  // Save listener → debounced diagnostic refresh. Only fires in Trusted Mode.
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      if (!isWorkspaceTrustedSync()) return;
      const profile = manager.current();
      if (!profile) return;
      const aggressive = vscode.workspace
        .getConfiguration("nodeforge.diagnostics")
        .get<boolean>("aggressiveRefresh", false);
      if (aggressive) {
        void diagManager.refresh().catch(() => undefined);
      } else {
        diagManager.triggerOnSave();
      }
    })
  );

  // Config-file watcher — re-runs detection when the workspace shape changes.
  const watcher = vscode.workspace.createFileSystemWatcher(
    "**/{package.json,pnpm-workspace.yaml,tsconfig.json,eslint.config.*,.prettierrc*,biome.json,prisma/schema.prisma,drizzle.config.*,Dockerfile,docker-compose.*}"
  );
  context.subscriptions.push(watcher);
  const onConfigChange = async (uri: vscode.Uri): Promise<void> => {
    const root = resolveWorkspaceRoot();
    if (!root) return;
    const rel = vscode.workspace.asRelativePath(uri, false);
    if (rel.includes("/")) {
      // Only re-analyze if the file is at the workspace root.
      return;
    }
    try {
      const profile = await manager.analyze(root);
      workspaceView.render(profile);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[nodeforge] refresh on config change failed", err);
    }
  };
  context.subscriptions.push(watcher.onDidChange(onConfigChange));
  context.subscriptions.push(watcher.onDidCreate(onConfigChange));
  context.subscriptions.push(watcher.onDidDelete(onConfigChange));

  // Dispose managers when the extension is deactivated.
  context.subscriptions.push({ dispose: () => diagManager.dispose() });
  context.subscriptions.push({ dispose: () => tests.dispose() });
  context.subscriptions.push({ dispose: () => procMgr.dispose() });

  // Auto-run once on activation if a folder is open and trusted.
  const root = resolveWorkspaceRoot();
  if (root && (await isWorkspaceTrusted())) {
    void manager.analyze(root).then(
      (profile) => {
        workspaceView.render(profile);
        // Kick off an initial diagnostic run so the sidebar is populated.
        void diagManager.refresh().catch((err) => {
          // eslint-disable-next-line no-console
          console.error("[nodeforge] initial diagnostic run failed", err);
        });
        // Detect git state on activation.
        void git.detect(root).then(
          (state) => gitView.setState(state),
          (err) => {
            // eslint-disable-next-line no-console
            console.error("[nodeforge] initial git detect failed", err);
          }
        );
        // Detect database schema if an ORM is present.
        if (dbManager.isEnabled()) {
          void dbManager.detect().then(
            (schema) => databaseView.setSchema(schema),
            (err) => {
              // eslint-disable-next-line no-console
              console.error("[nodeforge] initial database detect failed", err);
            }
          );
        }
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.error("[nodeforge] initial analyze failed", err);
      }
    );
  }
}

export function deactivate(): void {
  workspaceManager = undefined;
  diagnosticManager = undefined;
  testManager = undefined;
  processManager = undefined;
  databaseManager = undefined;
  dependencyManager = undefined;
  gitAdapter = undefined;
  eventBus = undefined;
}

function resolveWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;
  const first = folders[0];
  return first ? first.uri.fsPath : undefined;
}

async function isWorkspaceTrusted(): Promise<boolean> {
  const ws = vscode.workspace as typeof vscode.workspace & { isWorkspaceTrusted?: boolean };
  if (typeof ws.isWorkspaceTrusted === "boolean") return ws.isWorkspaceTrusted;
  return true;
}

function isWorkspaceTrustedSync(): boolean {
  const ws = vscode.workspace as typeof vscode.workspace & { isWorkspaceTrusted?: boolean };
  if (typeof ws.isWorkspaceTrusted === "boolean") return ws.isWorkspaceTrusted;
  return true;
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
