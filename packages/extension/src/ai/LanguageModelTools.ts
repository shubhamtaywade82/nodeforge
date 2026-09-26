import * as vscode from "vscode";
import type { NodeForgeContext } from "@nodeforge/agent";
import type { ExtensionWorkspaceSession } from "../core/ExtensionWorkspaceSession.js";

type EmptyInput = Record<string, never>;

interface RunScriptInput {
  script: string;
  args?: string[];
}

interface ToolSpec<TInput extends object> {
  readonly invocationMessage: string;
  readonly execute: (context: NodeForgeContext, input: TInput) => Promise<unknown>;
  readonly confirmation?: (
    input: TInput
  ) => { title: string; message: vscode.MarkdownString };
}

class NodeForgeLanguageModelTool<TInput extends object>
  implements vscode.LanguageModelTool<TInput> {
  constructor(
    private readonly session: ExtensionWorkspaceSession,
    private readonly spec: ToolSpec<TInput>
  ) {}

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<TInput>
  ): Promise<vscode.PreparedToolInvocation> {
    const prepared: vscode.PreparedToolInvocation = {
      invocationMessage: this.spec.invocationMessage
    };
    const confirmation = this.spec.confirmation?.(options.input);
    if (confirmation) prepared.confirmationMessages = confirmation;
    return prepared;
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<TInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    if (token.isCancellationRequested) {
      return this.textResult({ error: "Tool invocation cancelled." });
    }

    const nodeforge = this.session.getContext();
    if (!nodeforge) {
      return this.textResult({
        error: "No NodeForge workspace context is bound."
      });
    }

    try {
      const result = await this.spec.execute(nodeforge, options.input);
      return this.textResult(result);
    } catch (error) {
      return this.textResult({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private textResult(value: unknown): vscode.LanguageModelToolResult {
    const content =
      typeof value === "string" ? value : JSON.stringify(value, null, 2);

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(content ?? "No result.")
    ]);
  }
}

export function registerNodeForgeLanguageModelTools(
  context: vscode.ExtensionContext,
  session: ExtensionWorkspaceSession
): void {
  const register = <T extends object>(
    name: string,
    spec: ToolSpec<T>
  ): void => {
    context.subscriptions.push(
      vscode.lm.registerTool(
        name,
        new NodeForgeLanguageModelTool<T>(session, spec)
      )
    );
  };

  register<EmptyInput>("nodeforge_get_project_context", {
    invocationMessage: "Reading NodeForge project context",
    execute: (nodeforge) => nodeforge.getProfile()
  });

  register<EmptyInput>("nodeforge_get_diagnostics", {
    invocationMessage: "Running TypeScript and lint diagnostics",
    execute: (nodeforge) => nodeforge.getDiagnostics()
  });

  register<EmptyInput>("nodeforge_run_typecheck", {
    invocationMessage: "Running TypeScript typecheck",
    execute: (nodeforge) => nodeforge.runTypeCheck()
  });

  register<EmptyInput>("nodeforge_run_linter", {
    invocationMessage: "Running project linter",
    execute: (nodeforge) => nodeforge.runLinter()
  });

  register<EmptyInput>("nodeforge_get_tests", {
    invocationMessage: "Running project tests",
    execute: (nodeforge) => nodeforge.getTestResults()
  });

  register<{
    scope?: "working" | "staged" | "head-vs-upstream";
  }>("nodeforge_get_git_diff", {
    invocationMessage: "Reading Git changes",
    execute: (nodeforge, input) =>
      nodeforge.getGitDiff(input.scope ?? "working")
  });

  register<EmptyInput>("nodeforge_get_dependency_graph", {
    invocationMessage: "Analyzing dependency graph",
    execute: (nodeforge) => nodeforge.getDependencyGraph()
  });

  register<EmptyInput>("nodeforge_get_dependency_report", {
    invocationMessage: "Auditing dependencies",
    execute: (nodeforge) => nodeforge.getDependencyReport()
  });

  register<EmptyInput>("nodeforge_get_database_schema", {
    invocationMessage: "Reading database schema",
    execute: (nodeforge) => nodeforge.getDatabaseSchema()
  });

  register<RunScriptInput>("nodeforge_run_script", {
    invocationMessage: "Running package script",
    execute: (nodeforge, input) =>
      nodeforge.runScript(input.script, input.args ?? []),
    confirmation: (input) => ({
      title: "Run package script",
      message: new vscode.MarkdownString(
        "Run package script **" +
          input.script +
          "**?" +
          (input.args?.length
            ? "\n\nArguments: " + input.args.join(" ") + "."
            : "")
      )
    })
  });

  register<EmptyInput>("nodeforge_format_workspace", {
    invocationMessage: "Formatting workspace files",
    execute: (nodeforge) => nodeforge.formatFiles(),
    confirmation: () => ({
      title: "Format workspace",
      message: new vscode.MarkdownString(
        "Run the project's configured formatter across the workspace?"
      )
    })
  });

  register<EmptyInput>("nodeforge_validate_workspace", {
    invocationMessage: "Running workspace verification",
    execute: (nodeforge) => nodeforge.validateWorkspace()
  });
}
