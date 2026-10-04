import * as vscode from "vscode";
import { describeScriptRisk, executeTool, type NodeForgeContext } from "@nodeforge/agent";
import type { ExtensionWorkspaceSession } from "../core/ExtensionWorkspaceSession.js";
import { isWorkspaceTrusted } from "../core/workspaceTrust.js";
import { summarizePatch } from "./patchSummary.js";

type EmptyInput = Record<string, never>;

interface RunScriptInput {
  script: string;
  args?: string[];
}

interface ToolSpec<TInput extends object> {
  readonly toolName: string;
  readonly invocationMessage: string;
  readonly confirmation?: (
    input: TInput,
    context: NodeForgeContext | undefined
  ) => Promise<{ title: string; message: vscode.MarkdownString }> | { title: string; message: vscode.MarkdownString };
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
    const confirmation = await this.spec.confirmation?.(options.input, this.session.getContext());
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

    const trusted = isWorkspaceTrusted();

    try {
      const result = await executeTool(
        this.spec.toolName,
        options.input as Record<string, unknown>,
        nodeforge,
        {
          caller: "vscode",
          workspaceTrusted: trusted,
          executionAllowed: trusted,
          writesAllowed: trusted,
          networkAllowed: trusted,
          // A native VS Code tool reaches invoke() after the host has handled
          // prepareInvocation. write-tool specs provide explicit confirmation.
          approvalGranted: true
        }
      );
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
    toolName: "getProjectContext",
    invocationMessage: "Reading NodeForge project context"
  });

  register<EmptyInput>("nodeforge_get_diagnostics", {
    toolName: "getDiagnostics",
    invocationMessage: "Running TypeScript and lint diagnostics"
  });

  register<EmptyInput>("nodeforge_run_typecheck", {
    toolName: "runTypeCheck",
    invocationMessage: "Running TypeScript typecheck"
  });

  register<EmptyInput>("nodeforge_run_linter", {
    toolName: "runLinter",
    invocationMessage: "Running project linter"
  });

  register<EmptyInput>("nodeforge_get_tests", {
    toolName: "getTestResults",
    invocationMessage: "Running project tests"
  });

  register<{
    scope?: "working" | "staged" | "head-vs-upstream";
  }>("nodeforge_get_git_diff", {
    toolName: "getGitDiff",
    invocationMessage: "Reading Git changes"
  });

  register<EmptyInput>("nodeforge_get_dependency_graph", {
    toolName: "getDependencyGraph",
    invocationMessage: "Analyzing dependency graph"
  });

  register<EmptyInput>("nodeforge_get_dependency_report", {
    toolName: "getDependencyReport",
    invocationMessage: "Auditing dependencies"
  });

  register<EmptyInput>("nodeforge_get_database_schema", {
    toolName: "getDatabaseSchema",
    invocationMessage: "Reading database schema"
  });

  register<RunScriptInput>("nodeforge_run_script", {
    toolName: "runScript",
    invocationMessage: "Running package script",
    confirmation: async (input, nodeforge) => {
      const args = input.args?.length ? `\n\nArguments: \`${input.args.join(" ").replace(/`/g, "'")}\`` : "";
      if (!nodeforge) {
        return {
          title: "Run package script",
          message: new vscode.MarkdownString(`Run package script **${input.script.replace(/[*_`]/g, "")}**?${args}`)
        };
      }
      const { risk, packageManager } = await nodeforge.getScriptRisk(input.script);
      return {
        title: `Run script "${input.script.replace(/[*_`"]/g, "")}" — ${risk.level} risk`,
        message: new vscode.MarkdownString(describeScriptRisk(risk, packageManager) + args)
      };
    }
  });

  register<{ path: string; startLine?: number; endLine?: number }>("nodeforge_read_file", {
    toolName: "readFile",
    invocationMessage: "Reading source file"
  });

  register<{
    query: string;
    regex?: boolean;
    caseSensitive?: boolean;
    extensions?: string[];
    maxResults?: number;
  }>("nodeforge_search_code", {
    toolName: "searchCode",
    invocationMessage: "Searching source code"
  });

  register<{ edits: Array<{ path: string; oldText: string; newText: string }> }>("nodeforge_apply_patch", {
    toolName: "applyPatch",
    invocationMessage: "Applying source edits",
    confirmation: (input) => {
      const summary = summarizePatch(input);
      return { title: summary.title, message: new vscode.MarkdownString(summary.markdown) };
    }
  });

  register<EmptyInput>("nodeforge_format_workspace", {
    toolName: "formatFiles",
    invocationMessage: "Formatting workspace files",
    confirmation: () => ({
      title: "Format workspace",
      message: new vscode.MarkdownString(
        "Run the project's configured formatter across the workspace?"
      )
    })
  });

  register<EmptyInput>("nodeforge_validate_workspace", {
    toolName: "validateWorkspace",
    invocationMessage: "Running workspace verification"
  });
}
