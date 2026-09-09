/**
 * GitHub Actions contracts — produced by `packages/adapters/github-actions`.
 *
 * Represents the structure of `.github/workflows/*.yml` files.
 */

export interface GitHubWorkflowTrigger {
  /** Trigger kind: push, pull_request, workflow_dispatch, schedule, etc. */
  kind: string;
  /** Branches filter. */
  branches?: string[];
  /** Paths filter. */
  paths?: string[];
  /** Tags filter. */
  tags?: string[];
  /** For schedule triggers: cron expressions. */
  cron?: string[];
  /** For workflow_dispatch: input definitions. */
  inputs?: Record<string, {
    type: "string" | "boolean" | "choice" | "environment";
    description?: string;
    required?: boolean;
    default?: string | boolean;
    options?: string[];
  }>;
}

export interface GitHubJobStep {
  /** Step name. */
  name?: string;
  /** Action to run (e.g. `actions/checkout@v4`). */
  uses?: string;
  /** Shell command to run. */
  run?: string;
  /** `with:` inputs. */
  with?: Record<string, string | number | boolean>;
  /** `if:` condition. */
  if?: string;
  /** Environment variables for the step. */
  env?: Record<string, string>;
  /** `id:` of the step. */
  id?: string;
  /** `continue-on-error:` flag. */
  continueOnError?: boolean;
  /** Timeout in minutes. */
  timeoutMinutes?: number;
}

export interface GitHubJob {
  /** Job name (defaults to job id if not set). */
  name?: string;
  /** `runs-on:` runner, e.g. `ubuntu-latest`. */
  runsOn?: string | string[];
  /** Job needs: dependencies on other jobs. */
  needs?: string[];
  /** Steps. */
  steps: GitHubJobStep[];
  /** Environment variables for the job. */
  env?: Record<string, string>;
  /** Strategy matrix. */
  strategy?: {
    matrix?: Record<string, string[]>;
    failFast?: boolean;
    maxParallel?: number;
  };
  /** Timeout in minutes. */
  timeoutMinutes?: number;
  /** Condition for the job to run. */
  if?: string;
  /** Permissions. */
  permissions?: Record<string, string>;
}

/**
 * Structured representation of a GitHub Actions workflow file.
 */
export interface GitHubWorkflow {
  /** Absolute path to the workflow file. */
  path: string;
  /** Workflow name. */
  name: string;
  /** Triggers (`on:`). */
  triggers: GitHubWorkflowTrigger[];
  /** Environment variables. */
  env?: Record<string, string>;
  /** Concurrency config. */
  concurrency?: {
    group?: string;
    cancelInProgress?: boolean;
  };
  /** Permissions. */
  permissions?: Record<string, string>;
  /** Jobs. */
  jobs: Array<{
    /** Job id (the key in the YAML). */
    id: string;
    /** Job definition. */
    job: GitHubJob;
  }>;
}

/**
 * Combined GitHub Actions intelligence for a workspace.
 */
export interface GitHubActionsConfig {
  /** Root directory scanned. */
  root: string;
  /** All workflows found. */
  workflows: GitHubWorkflow[];
}
