/**
 * ESLint adapter.
 *
 * Runs the project's own ESLint via `eslint --format json` and parses the
 * structured JSON output into normalized `Diagnostic[]`. We do NOT reimplement
 * ESLint — we discover the project's local installation and wrap its CLI.
 *
 * The JSON output format is documented at:
 * https://eslint.org/docs/latest/use/formatters/#json
 *
 * Each result entry corresponds to a file, with `messages[]` containing
 * individual findings. Each message has `ruleId`, `severity` (1=warning,
 * 2=error), `message`, `line`, `column`, `endLine`, `endColumn`, and
 * optionally `fix` (when auto-fixable).
 */

import * as path from "node:path";
import {
  AdapterParseError,
  FileNotFoundError,
  type Diagnostic,
  type DiagnosticSeverity,
  type CommandRequest
} from "@nodeforge/contracts";
import { ProcessRunner, resolveExecutable } from "@nodeforge/runner";

export interface EslintAdapterOptions {
  /** Override the path to the ESLint binary. If unset, adapter resolves from the workspace. */
  eslintPath?: string;
  /** Glob patterns to lint. Defaults to ["."]. */
  patterns?: string[];
  /** Hard timeout for the eslint run, in ms. Defaults to 60_000. */
  timeoutMs?: number;
  /** Extra args to pass to eslint (e.g. ["--no-warn-ignored"]). */
  extraArgs?: string[];
}

export interface EslintRunResult {
  diagnostics: Diagnostic[];
  /** Raw eslint stdout (the JSON payload). */
  rawStdout: string;
  rawStderr: string;
  durationMs: number;
  exitCode: number | null;
}

const DEFAULT_TIMEOUT_MS = 60_000;

const ESLINT_CONFIG_FILES = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts"
];

export class EslintAdapter {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly options: EslintAdapterOptions = {}
  ) {}

  /**
   * Run ESLint for the given workspace root.
   *
   * Resolution order for the ESLint binary:
   *   1. `<root>/node_modules/.bin/eslint`
   *   2. `<root>/node_modules/eslint/bin/eslint.js`
   *   3. PATH lookup via `resolveExecutable("eslint")`
   *
   * ESLint exits 0 on success, 1 on lint errors, 2 on config/system errors.
   * We treat exit 1 as "diagnostics present" rather than throwing.
   */
  async run(workspaceRoot: string, signal?: AbortSignal): Promise<EslintRunResult> {
    const eslintBin = this.options.eslintPath ?? (await resolveEslintBinary(workspaceRoot));
    if (!eslintBin) {
      throw new FileNotFoundError("eslint");
    }

    const patterns = this.options.patterns ?? ["."];
    const args = ["--format", "json", ...patterns];
    if (this.options.extraArgs) {
      args.push(...this.options.extraArgs);
    }

    const request: CommandRequest = {
      command: eslintBin,
      args,
      cwd: workspaceRoot,
      timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal
    };

    const result = await this.runner.run(request);

    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    const exitCode = result.exitCode ?? null;

    // Exit 2 means config or system error — surface as a parse failure.
    if (exitCode === 2) {
      throw new AdapterParseError("eslint", `ESLint exited with code 2 (config error): ${stderr || stdout}`);
    }

    const diagnostics = parseEslintJsonOutput(stdout, workspaceRoot);

    return {
      diagnostics,
      rawStdout: stdout,
      rawStderr: stderr,
      durationMs: result.durationMs,
      exitCode
    };
  }

  /**
   * Returns true if an ESLint config file exists in `workspaceRoot`.
   * Used by the diagnostic manager to decide whether to enable the adapter.
   */
  static async hasConfig(workspaceRoot: string): Promise<boolean> {
    const fs = await import("node:fs/promises");
    for (const candidate of ESLINT_CONFIG_FILES) {
      try {
        await fs.access(path.join(workspaceRoot, candidate));
        return true;
      } catch {
        // continue
      }
    }
    return false;
  }
}

async function resolveEslintBinary(workspaceRoot: string): Promise<string | undefined> {
  const localBin = path.join(workspaceRoot, "node_modules", ".bin", "eslint");
  try {
    const fs = await import("node:fs/promises");
    await fs.access(localBin);
    return localBin;
  } catch {
    // next
  }

  const directPath = path.join(workspaceRoot, "node_modules", "eslint", "bin", "eslint.js");
  try {
    const fs = await import("node:fs/promises");
    await fs.access(directPath);
    return directPath;
  } catch {
    // fall through to PATH
  }

  return resolveExecutable("eslint");
}

// JSON shape produced by `eslint --format json`.
interface EslintJsonResult {
  filePath: string;
  messages: EslintMessage[];
  suppressedMessages?: EslintMessage[];
  errorCount: number;
  fatalErrorCount: number;
  warningCount: number;
  fixableErrorCount: number;
  fixableWarningCount: number;
  usedDeprecatedRules?: string[];
}

interface EslintMessage {
  ruleId: string | null;
  severity: 1 | 2; // 1=warning, 2=error
  message: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  fix?: { range: [number, number]; text: string };
  suggestions?: Array<{ desc: string; fix: { range: [number, number]; text: string } }>;
  fatal?: boolean;
  messageId?: string;
  nodeType?: string;
}

/**
 * Parse `eslint --format json` stdout into normalized diagnostics.
 */
export function parseEslintJsonOutput(stdout: string, workspaceRoot: string): Diagnostic[] {
  let parsed: EslintJsonResult[];
  try {
    parsed = JSON.parse(stdout) as EslintJsonResult[];
  } catch (err) {
    throw new AdapterParseError("eslint", `Failed to parse JSON output: ${(err as Error).message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new AdapterParseError("eslint", "Expected an array of ESLint results");
  }

  const diagnostics: Diagnostic[] = [];

  for (const fileResult of parsed) {
    const absFile = path.resolve(workspaceRoot, fileResult.filePath);
    for (const msg of fileResult.messages) {
      const line = msg.line ?? 1;
      const column = msg.column ?? 1;
      const severity = mapSeverity(msg.severity, msg.fatal === true);
      const rule = msg.ruleId ?? "eslint";

      diagnostics.push({
        id: `eslint:${rule}:${absFile}:${line}:${column}`,
        source: "eslint",
        severity,
        message: msg.message,
        file: absFile,
        range: {
          line,
          column,
          endLine: msg.endLine,
          endColumn: msg.endColumn
        },
        rule,
        code: rule,
        fixable: msg.fix !== undefined,
        suggestion: msg.suggestions?.[0]?.desc
      });
    }
  }

  return diagnostics;
}

function mapSeverity(severity: 1 | 2, fatal: boolean): DiagnosticSeverity {
  if (fatal) return "error";
  return severity === 2 ? "error" : "warning";
}
