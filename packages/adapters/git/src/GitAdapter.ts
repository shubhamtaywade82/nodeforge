/**
 * Git adapter.
 *
 * Wraps the `git` CLI to produce a normalized `GitState` for the current
 * workspace. We do NOT reimplement git — we run a small set of porcelain
 * commands and parse their structured output.
 *
 * Commands used:
 *   - `git rev-parse --show-toplevel`        → workspace root (or undefined)
 *   - `git rev-parse --short=10 HEAD`         → headShort
 *   - `git symbolic-ref --short HEAD`         → branch name (or HEAD if detached)
 *   - `git rev-parse --abbrev-ref @{u}`       → upstream tracking branch
 *   - `git status --porcelain=v2 --branch`    → dirty, ahead/behind, file status
 *   - `git diff --name-only`                  → unstaged changes
 *   - `git diff --cached --name-only`         → staged changes
 *
 * If `git` is unavailable or the workspace isn't a git repo, `detect()`
 * returns `undefined` rather than throwing.
 */

import * as path from "node:path";
import {
  type CommandRequest,
  type GitState
} from "@nodeforge/contracts";
import { ProcessRunner, resolveExecutable } from "@nodeforge/runner";

export interface GitAdapterOptions {
  /** Override the path to the git binary. If unset, adapter resolves from PATH. */
  gitPath?: string;
  /** Hard timeout per git command, in ms. Defaults to 10_000. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class GitAdapter {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly options: GitAdapterOptions = {}
  ) {}

  /**
   * Detect the Git state for `workspaceRoot`. Returns `undefined` if git is
   * not installed or the directory is not inside a git work tree.
   */
  async detect(workspaceRoot: string): Promise<GitState | undefined> {
    const gitBin = this.options.gitPath ?? (await resolveGitBinary());
    if (!gitBin) return undefined;

    // 1. Confirm we're inside a git work tree.
    const toplevelResult = await this.runGit(gitBin, workspaceRoot, [
      "rev-parse", "--show-toplevel"
    ]);
    if (toplevelResult.exitCode !== 0 || !toplevelResult.stdout.trim()) {
      return undefined;
    }
    const root = toplevelResult.stdout.trim();

    // 2. Branch + head short hash.
    const [branchResult, headShortResult, upstreamResult, statusResult, unstagedResult, stagedResult] =
      await Promise.all([
        this.runGit(gitBin, root, ["symbolic-ref", "--short", "HEAD"]),
        this.runGit(gitBin, root, ["rev-parse", "--short=10", "HEAD"]),
        this.runGit(gitBin, root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]),
        this.runGit(gitBin, root, ["status", "--porcelain=v2", "--branch"]),
        this.runGit(gitBin, root, ["diff", "--name-only"]),
        this.runGit(gitBin, root, ["diff", "--cached", "--name-only"])
      ]);

    // Branch: empty output means detached HEAD.
    const branch = branchResult.stdout.trim() || "HEAD";
    const detached = branch === "HEAD";

    const headShort = headShortResult.stdout.trim() || "";

    // Upstream may fail (no upstream configured) — treat as undefined.
    const upstream =
      upstreamResult.exitCode === 0 ? upstreamResult.stdout.trim() || undefined : undefined;

    // Parse porcelain v2 branch header for ahead/behind.
    let ahead = 0;
    let behind = 0;
    if (statusResult.exitCode === 0) {
      for (const line of statusResult.stdout.split(/\r?\n/)) {
        if (line.startsWith("# branch.ab ")) {
          // Format: "# branch.ab +<ahead> -<behind>"
          const parts = line.split(/\s+/);
          // parts[0] = "#", parts[1] = "branch.ab", parts[2] = "+N", parts[3] = "-N"
          const plus = parts[2];
          const minus = parts[3];
          if (plus && plus.startsWith("+")) ahead = parseInt(plus.slice(1), 10) || 0;
          if (minus && minus.startsWith("-")) behind = parseInt(minus.slice(1), 10) || 0;
        }
      }
    }

    const changedFiles = unstagedResult.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const stagedFiles = stagedResult.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const dirty = changedFiles.length > 0 || stagedFiles.length > 0;

    return {
      root,
      branch,
      detached,
      headShort,
      dirty,
      changedFiles,
      stagedFiles,
      ahead,
      behind,
      upstream
    };
  }

  /**
   * Returns true if `workspaceRoot` is inside a git work tree.
   */
  static async isGitRepo(workspaceRoot: string, runner: ProcessRunner, gitPath?: string): Promise<boolean> {
    const gitBin = gitPath ?? (await resolveGitBinary());
    if (!gitBin) return false;
    const request: CommandRequest = {
      command: gitBin,
      args: ["rev-parse", "--is-inside-work-tree"],
      cwd: workspaceRoot,
      timeoutMs: 5000
    };
    const result = await runner.run(request);
    return result.exitCode === 0 && result.stdout.trim() === "true";
  }

  private async runGit(
    gitBin: string,
    cwd: string,
    args: string[]
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    const request: CommandRequest = {
      command: gitBin,
      args,
      cwd,
      timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    };
    const result = await this.runner.run(request);
    return {
      exitCode: result.exitCode,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? ""
    };
  }
}

async function resolveGitBinary(): Promise<string | undefined> {
  return resolveExecutable("git");
}

/**
 * Parse a `git status --porcelain=v2 --branch` line into a structured form.
 * Exported for testing.
 *
 * Branch header lines start with `#`:
 *   # branch.head main
 *   # branch.oid a0c87ab3e2ff7184e390baeb36eda4b1e25f125b
 *   # branch.upstream origin/main
 *   # branch.ab +1 -2
 *
 * File status lines start with a digit:
 *   1 .M N... 100644 100644 100644 <hash> <hash> <path>
 *
 * Renames use `2` and have an `old` and `new` path separated by a tab.
 */
export interface ParsedPorcelainBranch {
  branch?: string;
  oid?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
}

export function parsePorcelainBranchHeader(stdout: string): ParsedPorcelainBranch {
  const out: ParsedPorcelainBranch = {};
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith("# ")) continue;
    const rest = line.slice(2);
    if (rest.startsWith("branch.head ")) {
      out.branch = rest.slice("branch.head ".length).trim();
    } else if (rest.startsWith("branch.oid ")) {
      out.oid = rest.slice("branch.oid ".length).trim();
    } else if (rest.startsWith("branch.upstream ")) {
      out.upstream = rest.slice("branch.upstream ".length).trim();
    } else if (rest.startsWith("branch.ab ")) {
      const parts = rest.slice("branch.ab ".length).trim().split(/\s+/);
      const plus = parts[0];
      const minus = parts[1];
      if (plus && plus.startsWith("+")) out.ahead = parseInt(plus.slice(1), 10) || 0;
      if (minus && minus.startsWith("-")) out.behind = parseInt(minus.slice(1), 10) || 0;
    }
  }
  return out;
}

/** Returns the relative path from the git repo root to `absPath`. */
export function relativize(root: string, absPath: string): string {
  return path.relative(root, absPath);
}
