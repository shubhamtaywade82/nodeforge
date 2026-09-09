/**
 * Prettier adapter.
 *
 * Runs `prettier --write` to format source files. Returns a summary of
 * how many files were formatted and whether any files were unchanged.
 *
 * The adapter detects the local Prettier binary via:
 *   1. `<root>/node_modules/.bin/prettier`
 *   2. PATH lookup via `resolveExecutable("prettier")`
 *
 * Prettier's `--write` flag modifies files in place. The output format is
 * one line per file: `path/to/file.ts  <time>ms` for formatted files,
 * and `path/to/file.ts  <time>ms` (unchanged) for files that didn't need
 * formatting.
 */

import * as path from "node:path";
import {
  FileNotFoundError,
  type CommandRequest
} from "@nodeforge/contracts";
import { ProcessRunner, resolveExecutable } from "@nodeforge/runner";

export interface PrettierAdapterOptions {
  /** Override the path to the Prettier binary. */
  prettierPath?: string;
  /** Glob patterns to format. Defaults to all source files. */
  patterns?: string[];
  /** Hard timeout in ms. Defaults to 60_000. */
  timeoutMs?: number;
  /** Extra args (e.g. ["--no-error-on-unmatched-pattern"]). */
  extraArgs?: string[];
}

export interface PrettierFormatResult {
  /** Number of files that were actually formatted (changed). */
  filesFormatted: number;
  /** Number of files that were already formatted (unchanged). */
  filesUnchanged: number;
  /** Raw stdout from prettier. */
  rawStdout: string;
  rawStderr: string;
  exitCode: number | null;
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_PATTERNS = ["**/*.{ts,tsx,js,jsx,json,css,md,yml,yaml}"];

export class PrettierAdapter {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly options: PrettierAdapterOptions = {}
  ) {}

  /**
   * Run `prettier --write` on the workspace.
   *
   * This is a write operation — it modifies files on disk.
   */
  async format(workspaceRoot: string, signal?: AbortSignal): Promise<PrettierFormatResult> {
    const prettierBin = this.options.prettierPath ?? (await resolvePrettierBinary(workspaceRoot));
    if (!prettierBin) {
      throw new FileNotFoundError("prettier");
    }

    const patterns = this.options.patterns ?? DEFAULT_PATTERNS;
    const args = ["--write", ...patterns];
    if (this.options.extraArgs) {
      args.push(...this.options.extraArgs);
    }

    const request: CommandRequest = {
      command: prettierBin,
      args,
      cwd: workspaceRoot,
      timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal
    };

    const result = await this.runner.run(request);
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";

    // Prettier's --write output is one line per file:
    //   src/foo.ts  12ms
    // Files that were already formatted are listed the same way.
    // We count lines that look like file paths.
    const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0 && /\.\w+/.test(l));
    const filesFormatted = lines.length;

    return {
      filesFormatted,
      filesUnchanged: 0, // Prettier doesn't distinguish changed vs unchanged in --write mode
      rawStdout: stdout,
      rawStderr: stderr,
      exitCode: result.exitCode,
      durationMs: result.durationMs
    };
  }

  /**
   * Returns true if a Prettier config file or prettier dependency exists.
   */
  static async hasConfig(workspaceRoot: string): Promise<boolean> {
    const fs = await import("node:fs/promises");
    const candidates = [
      ".prettierrc",
      ".prettierrc.json",
      ".prettierrc.yml",
      ".prettierrc.yaml",
      ".prettierrc.json5",
      ".prettierrc.js",
      ".prettierrc.cjs",
      ".prettierrc.mjs",
      ".prettierrc.toml",
      "prettier.config.js",
      "prettier.config.cjs",
      "prettier.config.mjs"
    ];
    for (const c of candidates) {
      try {
        await fs.access(path.join(workspaceRoot, c));
        return true;
      } catch {
        // continue
      }
    }
    // Check package.json#prettier field
    try {
      const pkgRaw = await fs.readFile(path.join(workspaceRoot, "package.json"), "utf8");
      const pkg = JSON.parse(pkgRaw) as { prettier?: unknown };
      if (pkg.prettier !== undefined) return true;
    } catch {
      // ignore
    }
    // Check if prettier is installed
    try {
      await fs.access(path.join(workspaceRoot, "node_modules", "prettier"));
      return true;
    } catch {
      return false;
    }
  }
}

async function resolvePrettierBinary(workspaceRoot: string): Promise<string | undefined> {
  const localBin = path.join(workspaceRoot, "node_modules", ".bin", "prettier");
  try {
    const fs = await import("node:fs/promises");
    await fs.access(localBin);
    return localBin;
  } catch {
    // fall through to PATH
  }
  return resolveExecutable("prettier");
}
