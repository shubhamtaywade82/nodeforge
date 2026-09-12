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

import {
  InMemoryEventBus,
  NodeFilesystemReader,
  ProcessManager,
  buildDevDocsUrl,
  devDocsDefaultSlug,
  DEVDOCS_HOME_URL
} from "@nodeforge/core";
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
import { DependencyGraphManager } from "./core/DependencyGraphManager.js";
import { ExtensionWorkspaceSession } from "./core/ExtensionWorkspaceSession.js";
import { DependencyDiagnosticPublisher } from "./diagnostics/DependencyDiagnosticPublisher.js";
import { ChatController } from "./chat/ChatController.js";
import { ChatWebviewProvider } from "./chat/ChatWebviewProvider.js";
import { DevDocsWebviewProvider } from "./docs/DevDocsWebviewProvider.js";
import { DevDocsOfflineManager } from "./docs/DevDocsOfflineManager.js";
import { openOfflineDocPanel } from "./docs/DevDocsOfflinePanel.js";
import { DiagnosticsBridge } from "./core/DiagnosticsBridge.js";
import { StatusBarController } from "./core/StatusBarController.js";
import { NodeForgeTaskProvider } from "./core/NodeForgeTaskProvider.js";
import { NodeForgeTestController } from "./core/NodeForgeTestController.js";
import { NodeForgeCodeActionProvider } from "./core/NodeForgeCodeActionProvider.js";
import { NodeForgeCodeLensProvider } from "./core/NodeForgeCodeLensProvider.js";
import { NodeForgeDebugConfigurationProvider } from "./core/NodeForgeDebugConfigurationProvider.js";
import { NodeForgeHoverProvider } from "./core/NodeForgeHoverProvider.js";
import { RuntimeTerminalManager } from "./core/RuntimeTerminalManager.js";
import { DependencyGraphPanel } from "./core/DependencyGraphPanel.js";
import { DatabaseSchemaPanel } from "./core/DatabaseSchemaPanel.js";
import { logger } from "./core/Logger.js";

let workspaceManager: WorkspaceManager | undefined;
let diagnosticManager: DiagnosticManager | undefined;
let testManager: TestManager | undefined;
let processManager: ProcessManager | undefined;
let databaseManager: DatabaseManager | undefined;
let dependencyManager: DependencyManager | undefined;
let dependencyGraphManager: DependencyGraphManager | undefined;
let workspaceSession: ExtensionWorkspaceSession | undefined;
let dependencyDiagnostics: DependencyDiagnosticPublisher | undefined;
let chatWebviewProvider: ChatWebviewProvider | undefined;
let devDocsProvider: DevDocsWebviewProvider | undefined;
let devDocsOffline: DevDocsOfflineManager | undefined;
let gitAdapter: GitAdapter | undefined;
let eventBus: EventBus | undefined;

const CHAT_API_KEY_SECRET = "nodeforge.chat.apiKey";
let depAuditTimer: ReturnType<typeof setTimeout> | undefined;
let depGraphTimer: ReturnType<typeof setTimeout> | undefined;

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
  const graphManager = new DependencyGraphManager(bus);
  dependencyGraphManager = graphManager;
  const session = new ExtensionWorkspaceSession(bus);
  workspaceSession = session;
  const depDiagPublisher = new DependencyDiagnosticPublisher();
  dependencyDiagnostics = depDiagPublisher;
  const chatController = new ChatController(
    session,
    async () => context.secrets.get(CHAT_API_KEY_SECRET),
    isTrusted
  );
  const chatProvider = new ChatWebviewProvider(context, session, chatController, isTrusted);
  chatWebviewProvider = chatProvider;
  const git = new GitAdapter(runner);
  gitAdapter = git;

  const rootOnActivate = resolveWorkspaceRoot();
  if (rootOnActivate) {
    session.bindRoot(rootOnActivate);
  }

  // Bridge diagnostics from the DiagnosticStore to VS Code's Problems panel.
  const diagnosticsBridge = new DiagnosticsBridge(bus);

  // Status bar with diagnostic counts + git branch.
  const statusBar = new StatusBarController(bus);

  // Native Test Explorer integration.
  const testController = new NodeForgeTestController(tests, bus);

  // Quick Fix lightbulbs for ESLint/Biome diagnostics.
  const codeActionProvider = new NodeForgeCodeActionProvider();

  // Code Lens: "Run Test" above it() calls, "Audit Deps" above package.json.
  const codeLensProvider = new NodeForgeCodeLensProvider();

  // Hover provider: shows rule docs + advisory URLs on hover.
  const hoverProvider = new NodeForgeHoverProvider(diagManager.getStore());

  // Runtime terminal manager: real interactive terminals for dev processes.
  const runtimeTerminalMgr = new RuntimeTerminalManager();

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
  const devDocs = new DevDocsWebviewProvider(context.extensionUri);
  devDocsProvider = devDocs;
  const devDocsOfflineMgr = new DevDocsOfflineManager(context);
  devDocsOffline = devDocsOfflineMgr;

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
    vscode.window.registerWebviewViewProvider("nodeforge.chat", chatProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.window.registerWebviewViewProvider("nodeforge.docs", devDocs, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    { dispose: () => depDiagPublisher.dispose() },
    diagnosticsBridge,
    statusBar,
    testController,
    runtimeTerminalMgr,
    vscode.languages.registerCodeActionsProvider(
      { scheme: "file", language: "typescript" },
      codeActionProvider,
      { providedCodeActionKinds: NodeForgeCodeActionProvider.providedCodeActionKinds }
    ),
    vscode.languages.registerCodeActionsProvider(
      { scheme: "file", language: "javascript" },
      codeActionProvider,
      { providedCodeActionKinds: NodeForgeCodeActionProvider.providedCodeActionKinds }
    ),
    vscode.languages.registerCodeLensProvider(
      { scheme: "file", language: "typescript" },
      codeLensProvider
    ),
    vscode.languages.registerCodeLensProvider(
      { scheme: "file", language: "javascript" },
      codeLensProvider
    ),
    vscode.languages.registerHoverProvider(
      { scheme: "file", language: "typescript" },
      hoverProvider
    ),
    vscode.languages.registerHoverProvider(
      { scheme: "file", language: "javascript" },
      hoverProvider
    ),
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
        session.bindRoot(r);
        const profile = await manager.analyze(r);
        workspaceView.render(profile);
        treeViews.workspace!.message = undefined;
        devDocs.setProfile(profile);
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
          session.setDependencyReport(report);
          depDiagPublisher.publishReport(report);
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
    vscode.commands.registerCommand("nodeforge.analyzeDependencyGraph", async () => {
      const root = resolveWorkspaceRoot();
      if (!root) return;
      if (!isTrusted()) {
        void vscode.window.showWarningMessage("NodeForge: graph analysis requires Workspace Trust.");
        return;
      }
      if (!manager.current()) {
        await manager.analyze(root);
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: "NodeForge: analyzing dependency graph" },
        async () => {
          const analysis = await graphManager.analyze();
          dependencyView.setGraphAnalysis(analysis);
          session.setGraphAnalysis(analysis);
          if (analysis && root) {
            depDiagPublisher.publishGraph(analysis, root);
          }
          if (analysis) {
            void vscode.window.showInformationMessage(
              `NodeForge: ${analysis.unused.length} unused, ${analysis.circular.length} circular, ${analysis.missing.length} missing`
            );
          }
        }
      );
    }),

    vscode.commands.registerCommand("nodeforge.showOutput", () => {
      logger.show();
    }),

    // Quick Fix: apply ESLint --fix to the current file.
    vscode.commands.registerCommand("nodeforge.applyEslintFix", async () => {
      const r = resolveWorkspaceRoot();
      if (!r || !isTrusted()) return;
      if (!manager.current()) await manager.analyze(r);
      const profile = manager.current();
      if (profile?.linter !== "eslint") {
        void vscode.window.showWarningMessage("NodeForge: ESLint is not the detected linter.");
        return;
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: "NodeForge: applying ESLint fixes" },
        async () => {
          const { EslintAdapter } = await import("@nodeforge/adapter-eslint");
          const adapter = new EslintAdapter(runner);
          try {
            const result = await adapter.fix(r);
            logger.info(`ESLint --fix: ${result.diagnostics.length} remaining diagnostics`);
            await diagManager.refresh();
          } catch (err) {
            logger.error("ESLint --fix failed", err);
          }
        }
      );
    }),

    vscode.commands.registerCommand("nodeforge.setChatApiKey", async () => {
      const key = await vscode.window.showInputBox({
        title: "NodeForge Chat API Key",
        password: true,
        ignoreFocusOut: true,
        prompt: "OpenAI-compatible API key (stored in VS Code Secret Storage)"
      });
      if (key === undefined) return;
      if (!key.trim()) {
        await context.secrets.delete(CHAT_API_KEY_SECRET);
        void vscode.window.showInformationMessage("NodeForge: chat API key cleared.");
        return;
      }
      await context.secrets.store(CHAT_API_KEY_SECRET, key.trim());
      void vscode.window.showInformationMessage("NodeForge: chat API key saved.");
    }),
    vscode.commands.registerCommand("nodeforge.clearChat", () => {
      chatProvider.clearChat();
    }),
    vscode.commands.registerCommand("nodeforge.openChat", async () => {
      await vscode.commands.executeCommand("nodeforge-sidebar.focus");
      await vscode.commands.executeCommand("nodeforge.chat.focus");
    }),
    vscode.commands.registerCommand("nodeforge.openDevDocs", async () => {
      await openDevDocs(DEVDOCS_HOME_URL);
    }),
    vscode.commands.registerCommand("nodeforge.openDevDocsForWorkspace", async () => {
      const profile = manager.current();
      if (!profile) {
        void vscode.window.showWarningMessage("NodeForge: analyze the workspace first.");
        return;
      }
      await openDevDocs(buildDevDocsUrl({ slug: devDocsDefaultSlug(profile) }));
    }),
    vscode.commands.registerCommand("nodeforge.searchDevDocs", async () => {
      const query = readEditorSearchQuery();
      if (!query) {
        void vscode.window.showWarningMessage("NodeForge: select a symbol or word to search in DevDocs.");
        return;
      }
      await searchDevDocsWithOffline(context, query);
    }),
    vscode.commands.registerCommand("nodeforge.syncDevDocsOffline", async () => {
      const profile = manager.current();
      const slugs = devDocsOfflineMgr.slugsToSync(profile);
      await devDocsOfflineMgr.sync(slugs);
    }),

    // Quick Fix: apply Biome safe fixes to the current file.
    vscode.commands.registerCommand("nodeforge.applyBiomeFix", async () => {
      const r = resolveWorkspaceRoot();
      if (!r || !isTrusted()) return;
      if (!manager.current()) await manager.analyze(r);
      const profile = manager.current();
      if (profile?.linter !== "biome") {
        void vscode.window.showWarningMessage("NodeForge: Biome is not the detected linter.");
        return;
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: "NodeForge: applying Biome fixes" },
        async () => {
          const { BiomeAdapter } = await import("@nodeforge/adapter-biome");
          const adapter = new BiomeAdapter(runner);
          try {
            await adapter.format(r);
            logger.info("Biome format applied");
            await diagManager.refresh();
          } catch (err) {
            logger.error("Biome fix failed", err);
          }
        }
      );
    }),

    // Quick Fix: format the current file.
    vscode.commands.registerCommand("nodeforge.formatCurrentFile", async () => {
      const r = resolveWorkspaceRoot();
      if (!r || !isTrusted()) return;
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      await vscode.commands.executeCommand("editor.action.formatDocument");
    }),

    // CodeLens: run tests from the current file.
    vscode.commands.registerCommand("nodeforge.runTestFromFile", async (filePath: string, _line: number) => {
      const r = resolveWorkspaceRoot();
      if (!r || !isTrusted()) return;
      if (!manager.current()) await manager.analyze(r);
      if (!tests.isEnabled()) {
        void vscode.window.showWarningMessage("NodeForge: no test runner detected.");
        return;
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: "NodeForge: running tests" },
        async () => {
          await tests.run().catch((err) => logger.error("Test run from CodeLens failed", err));
        }
      );
      logger.info(`Test run triggered from ${filePath}`);
    }),

    // CodeLens: debug a test from the current file.
    vscode.commands.registerCommand("nodeforge.debugTestFromFile", async (filePath: string, line: number) => {
      const r = resolveWorkspaceRoot();
      if (!r || !isTrusted()) return;
      if (!manager.current()) await manager.analyze(r);

      // Start a debug session with the test file.
      const config: vscode.DebugConfiguration = {
        name: "Debug Test",
        type: "node",
        request: "launch",
        runtimeExecutable: "npx",
        runtimeArgs: ["vitest", "run", filePath],
        cwd: r,
        console: "integratedTerminal",
        skipFiles: ["<node_internals>/**", "${workspaceFolder}/node_modules/**"],
        env: {}
      };
      await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], config);
      logger.info(`Debug test triggered for ${filePath}:${line}`);
    }),

    // Runtime terminal: start a dev server in a real terminal.
    vscode.commands.registerCommand("nodeforge.startDevServer", async () => {
      const r = resolveWorkspaceRoot();
      if (!r || !isTrusted()) return;
      if (!manager.current()) await manager.analyze(r);

      const profile = manager.current();
      if (!profile) return;

      const pm = profile.packageManager === "pnpm" ? "pnpm" : profile.packageManager === "yarn" ? "yarn" : "npm";

      // Check if there's a "dev" script in package.json.
      const pkg = await import("node:fs/promises").then((fs) =>
        fs.readFile(`${r}/package.json`, "utf8").then((raw) => JSON.parse(raw))
      ).catch(() => null);

      const scriptName = pkg?.scripts?.["dev"] ? "dev" : pkg?.scripts?.["start"] ? "start" : null;
      if (!scriptName) {
        void vscode.window.showWarningMessage("NodeForge: no 'dev' or 'start' script found in package.json.");
        return;
      }

      runtimeTerminalMgr.start({
        name: `dev: ${scriptName}`,
        command: pm,
        args: pm === "yarn" ? [scriptName] : ["run", scriptName],
        cwd: r
      });
      logger.info(`Started dev server: ${pm} run ${scriptName}`);
    }),

    // Webview: show dependency graph as interactive SVG diagram.
    vscode.commands.registerCommand("nodeforge.showDependencyGraph", async () => {
      const r = resolveWorkspaceRoot();
      if (!r) {
        void vscode.window.showWarningMessage("NodeForge: open a workspace folder first.");
        return;
      }
      await DependencyGraphPanel.createOrShow(context, r);
    }),

    // Webview: show database schema as ER diagram.
    vscode.commands.registerCommand("nodeforge.showDatabaseSchema", async () => {
      const r = resolveWorkspaceRoot();
      if (!r) return;
      if (!manager.current()) await manager.analyze(r);
      if (!dbManager.isEnabled()) {
        void vscode.window.showInformationMessage("NodeForge: no ORM detected (expected Prisma or Drizzle).");
        return;
      }
      const schema = await dbManager.detect();
      if (schema) {
        await DatabaseSchemaPanel.createOrShow(context, schema);
      } else {
        void vscode.window.showWarningMessage("NodeForge: could not detect database schema.");
      }
    })
  );

  bus.subscribe("dependencies.reported", (e) => {
    dependencyView.setReport(e.report);
    depDiagPublisher.publishReport(e.report);
  });
  bus.subscribe("dependencyGraph.analyzed", (e) => {
    dependencyView.setGraphAnalysis(e.analysis);
    const root = resolveWorkspaceRoot();
    if (root) {
      depDiagPublisher.publishGraph(e.analysis, root);
    }
  });

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
    session.bindRoot(r);
    try {
      const profile = await manager.analyze(r);
      workspaceView.render(profile);
      treeViews.workspace!.message = undefined;
      devDocs.setProfile(profile);
      scheduleBackgroundDependencyAudit(r, depManager, session);
      scheduleBackgroundDependencyGraph(r, graphManager, session, dependencyView, depDiagPublisher);
      logger.info(`Re-analyzed workspace after config change: ${vscode.workspace.asRelativePath(uri, false)}`);
    } catch (err) {
      logger.error("Refresh on config change failed", err);
    }
  };
  context.subscriptions.push(watcher.onDidChange(onConfigChange));
  context.subscriptions.push(watcher.onDidCreate(onConfigChange));
  context.subscriptions.push(watcher.onDidDelete(onConfigChange));

  // Multi-root workspace support: re-analyze when folders are added/removed.
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders((e) => {
      if (e.added.length > 0) {
        logger.info(`Workspace folder(s) added: ${e.added.map((f) => f.name).join(", ")}`);
        const newRoot = e.added[0]?.uri.fsPath;
        if (newRoot) {
          void manager.analyze(newRoot).then(
            (profile) => {
              workspaceView.render(profile);
              treeViews.workspace!.message = undefined;
            },
            (err) => logger.error("Re-analysis after folder add failed", err)
          );
        }
      }
      if (e.removed.length > 0) {
        logger.info(`Workspace folder(s) removed: ${e.removed.map((f) => f.name).join(", ")}`);
      }
    })
  );

  // Dispose managers when the extension is deactivated.
  context.subscriptions.push(
    { dispose: () => diagManager.dispose() },
    { dispose: () => tests.dispose() },
    { dispose: () => procMgr.dispose() }
  );

  // ─── Auto-run on activation ───

  if (root && isTrusted()) {
    logger.info(`Auto-running for workspace: ${root}`);

    // Register the Task Provider after we have a workspace root.
    const pm: "npm" | "pnpm" | "yarn" = "npm"; // default; will be updated after analyze
    const taskProvider = vscode.tasks.registerTaskProvider(
      NodeForgeTaskProvider.taskType,
      new NodeForgeTaskProvider(root, pm)
    );
    context.subscriptions.push(taskProvider);

    // Register the Debug Configuration Provider for F5 debugging.
    const debugProvider = new NodeForgeDebugConfigurationProvider(root, pm);
    context.subscriptions.push(
      vscode.debug.registerDebugConfigurationProvider("node", debugProvider)
    );

    // Discover tests for the Test Explorer.
    void testController.discoverTests().catch((err) => {
      logger.error("Initial test discovery failed", err);
    });

    session.bindRoot(root);
    void manager.analyze(root).then(
      (profile) => {
        workspaceView.render(profile);
        treeViews.workspace!.message = undefined;
        devDocs.setProfile(profile);
        scheduleBackgroundDependencyAudit(root, depManager, session);
        scheduleBackgroundDependencyGraph(root, graphManager, session, dependencyView, depDiagPublisher);
        scheduleBackgroundDevDocsSync(profile, devDocsOfflineMgr);
        void diagManager.refresh().catch((err) => {
          logger.error("Initial diagnostic run failed", err);
        });
        void git.detect(root).then(
          (state) => {
            gitView.setState(state);
            statusBar.setGitState(state);
          },
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
  dependencyGraphManager = undefined;
  workspaceSession = undefined;
  dependencyDiagnostics?.dispose();
  dependencyDiagnostics = undefined;
  chatWebviewProvider = undefined;
  devDocsProvider = undefined;
  devDocsOffline = undefined;
  gitAdapter = undefined;
  eventBus = undefined;
  if (depAuditTimer) {
    clearTimeout(depAuditTimer);
    depAuditTimer = undefined;
  }
  if (depGraphTimer) {
    clearTimeout(depGraphTimer);
    depGraphTimer = undefined;
  }
  if (devDocsSyncTimer) {
    clearTimeout(devDocsSyncTimer);
    devDocsSyncTimer = undefined;
  }
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

async function openDevDocs(url: string): Promise<void> {
  const preferExternal = vscode.workspace
    .getConfiguration("nodeforge.docs")
    .get<boolean>("preferExternal", false);
  if (preferExternal) {
    await vscode.env.openExternal(vscode.Uri.parse(url));
    return;
  }
  devDocsProvider?.navigate(url);
  await vscode.commands.executeCommand("nodeforge-sidebar.focus");
  await vscode.commands.executeCommand("nodeforge.docs.focus");
}

async function searchDevDocsWithOffline(context: vscode.ExtensionContext, query: string): Promise<void> {
  const offlineCfg = vscode.workspace.getConfiguration("nodeforge.docs.offline");
  const preferOffline = offlineCfg.get<boolean>("preferOfflineSearch", true);
  const mgr = devDocsOffline;
  if (preferOffline && mgr) {
    const hits = await mgr.search(query);
    if (hits.length > 0) {
      const pick = await vscode.window.showQuickPick(
        hits.map((h) => ({
          label: `${h.slug}: ${h.title}`,
          description: h.snippet,
          hit: h
        })),
        { placeHolder: `Offline DevDocs results for “${query}”` }
      );
      if (pick) {
        openOfflineDocPanel(context, mgr.htmlPath(pick.hit.slug, pick.hit.htmlFile), pick.hit.title);
        return;
      }
    }
  }
  await openDevDocs(buildDevDocsUrl({ query }));
}

let devDocsSyncTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleBackgroundDevDocsSync(profile: WorkspaceProfile, mgr: DevDocsOfflineManager): void {
  const cfg = vscode.workspace.getConfiguration("nodeforge.docs.offline");
  if (!cfg.get<boolean>("autoSync", false)) return;

  if (devDocsSyncTimer) clearTimeout(devDocsSyncTimer);
  devDocsSyncTimer = setTimeout(() => {
    const slugs = mgr.slugsToSync(profile);
    void mgr.sync(slugs);
  }, 4000);
}

function readEditorSearchQuery(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  const sel = editor.document.getText(editor.selection).trim();
  if (sel) return sel;
  const pos = editor.selection.active;
  const range = editor.document.getWordRangeAtPosition(pos);
  if (!range) return undefined;
  return editor.document.getText(range).trim() || undefined;
}

function scheduleBackgroundDependencyAudit(
  root: string,
  depManager: DependencyManager,
  session: ExtensionWorkspaceSession
): void {
  const enabled = vscode.workspace.getConfiguration("nodeforge.dependencies").get<boolean>("backgroundAudit", true);
  if (!enabled || !isTrusted()) return;

  if (depAuditTimer) clearTimeout(depAuditTimer);
  depAuditTimer = setTimeout(() => {
    void depManager.audit().then((report) => {
      if (report) {
        session.setDependencyReport(report);
      }
    });
  }, 1500);
}

function scheduleBackgroundDependencyGraph(
  root: string,
  graphManager: DependencyGraphManager,
  session: ExtensionWorkspaceSession,
  dependencyView: DependencyViewProvider,
  depDiagPublisher: DependencyDiagnosticPublisher
): void {
  const enabled = vscode.workspace
    .getConfiguration("nodeforge.dependencies")
    .get<boolean>("backgroundGraphAnalysis", true);
  if (!enabled || !isTrusted()) return;

  if (depGraphTimer) clearTimeout(depGraphTimer);
  depGraphTimer = setTimeout(() => {
    void graphManager.analyze().then((analysis) => {
      if (!analysis) return;
      dependencyView.setGraphAnalysis(analysis);
      session.setGraphAnalysis(analysis);
      depDiagPublisher.publishGraph(analysis, root);
    });
  }, 2500);
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
