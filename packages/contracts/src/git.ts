/**
 * Git state contract — produced by `packages/adapters/git`.
 */

export interface GitState {
  /** Workspace root where `git rev-parse --show-toplevel` resolves. */
  root: string;
  /** Current branch name, or `HEAD` if detached. */
  branch: string;
  /** True if HEAD is detached. */
  detached: boolean;
  /** Commit short hash (10 chars). */
  headShort: string;
  /** True if there are uncommitted changes in the working tree. */
  dirty: boolean;
  /** Relative paths of modified files (unstaged). */
  changedFiles: string[];
  /** Relative paths of staged files. */
  stagedFiles: string[];
  /** Number of commits ahead of upstream. */
  ahead: number;
  /** Number of commits behind upstream. */
  behind: number;
  /** Upstream tracking ref, e.g. `origin/main`, if set. */
  upstream?: string;
}

/** Diff scope for `getDiff` operations. */
export type GitDiffScope = "working" | "staged" | "head-vs-upstream";
