/**
 * NodeForge extension entry point.
 *
 * Activated on first `nodeforge.analyzeWorkspace` command or when the
 * sidebar view is opened. Wires together the detector, event bus, and
 * VS Code UI.
 */

import * as vscode from "vscode";

import { InMemoryEventBus, NodeFilesystemReader, detectWorkspaceProfile } from "@nodeforge/core";
import { ProcessRunner } from "@nodeforge/runner";
import type { EventBus, NodeForgeEvent, WorkspaceProfile } from "@nodeforge/contracts";

import { WorkspaceViewProvider } from "./ui/WorkspaceViewProvider.js";
import { DiagnosticsViewProvider } from "./ui/DiagnosticsViewProvider.js";
import { WorkspaceManager } from "./core/WorkspaceManager.js";

let workspaceManager: WorkspaceManager | undefined;
let eventBus: EventBus | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const bus: EventBus = new InMemoryEventBus();
  eventBus = bus;
  const detectorReader = new NodeFilesystemReader();
  const runner = new ProcessRunner();
  const manager = new WorkspaceManager(detectorReader, runner, bus);
  workspaceManager = manager;

  // Wire sidebar views.
  const workspaceView = new WorkspaceViewProvider(context, manager);
  const diagnosticsView = new DiagnosticsViewProvider(context, bus);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("nodeforge.workspace", workspaceView),
    vscode.window.registerTreeDataProvider("nodeforge.diagnostics", diagnosticsView)
  );

  // Commands.
  context.subscriptions.push(
    vscode.commands.registerCommand("nodeforge.analyzeWorkspace", async () => {
      const root = resolveWorkspaceRoot();
      if (!root) {
        void vscode.window.showWarningMessage(
          "NodeForge: open a workspace folder before analyzing."
        );
        return;
      }
      if (!(await isWorkspaceTrusted())) {
        void vscode.window.showWarningMessage(
          "NodeForge: this operation requires Workspace Trust."
        );
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
    })
  );

  // Re-run detection when package.json or known config files change.
  const watcher = vscode.workspace.createFileSystemWatcher(
    "**/{package.json,pnpm-workspace.yaml,tsconfig.json,eslint.config.*,.prettierrc*,biome.json,prisma/schema.prisma,drizzle.config.*,Dockerfile,docker-compose.*}"
  );
  context.subscriptions.push(watcher);
  const onConfigChange = async (uri: vscode.Uri): Promise<void> => {
    if (!manager) return;
    const root = resolveWorkspaceRoot();
    if (!root) return;
    // Skip events outside the workspace root.
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

  // Auto-run once on activation if a folder is open.
  const root = resolveWorkspaceRoot();
  if (root && (await isWorkspaceTrusted())) {
    void manager.analyze(root).then(
      (profile) => workspaceView.render(profile),
      (err) => {
        // eslint-disable-next-line no-console
        console.error("[nodeforge] initial analyze failed", err);
      }
    );
  }
}

export function deactivate(): void {
  workspaceManager = undefined;
  eventBus = undefined;
}

function resolveWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;
  const first = folders[0];
  return first ? first.uri.fsPath : undefined;
}

async function isWorkspaceTrusted(): Promise<boolean> {
  // `isWorkspaceTrusted` exists on `vscode.workspace` from 1.56+.
  // The cast handles older typings that may not include it.
  const ws = vscode.workspace as typeof vscode.workspace & { isWorkspaceTrusted?: boolean };
  if (typeof ws.isWorkspaceTrusted === "boolean") return ws.isWorkspaceTrusted;
  // Fallback: assume trusted (VS Code < 1.56). Document this in README.
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
export { workspaceManager, eventBus };
export type { EventBus, NodeForgeEvent };
