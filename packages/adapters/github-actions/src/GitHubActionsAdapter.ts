/**
 * GitHub Actions adapter.
 *
 * Parses `.github/workflows/*.yml` files into the normalized
 * `GitHubActionsConfig` contract.
 *
 * The parser uses the `yaml` library to parse the YAML, then walks the
 * well-known keys: `name`, `on`, `env`, `concurrency`, `permissions`, `jobs`.
 *
 * `on:` can be a string, an array, or an object (the most common form):
 *
 *   on:
 *     push:
 *       branches: [main]
 *       paths: ["src/**"]
 *     workflow_dispatch:
 *       inputs:
 *         debug:
 *           type: boolean
 *           default: false
 *     schedule:
 *       - cron: "0 2 * * 1"
 *
 * We normalize all forms into `GitHubWorkflowTrigger[]`.
 */

import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  AdapterParseError,
  type GitHubActionsConfig,
  type GitHubJob,
  type GitHubJobStep,
  type GitHubWorkflow,
  type GitHubWorkflowTrigger
} from "@nodeforge/contracts";

const WORKFLOWS_DIR = ".github/workflows";

export class GitHubActionsAdapter {
  /**
   * Detect GitHub Actions workflows in `workspaceRoot`. Returns a
   * `GitHubActionsConfig` with all workflows found in `.github/workflows/`.
   * If no workflows exist, returns an empty result.
   */
  async detect(workspaceRoot: string): Promise<GitHubActionsConfig> {
    const fs = await import("node:fs/promises");
    const workflowsDir = path.join(workspaceRoot, WORKFLOWS_DIR);
    const workflows: GitHubWorkflow[] = [];

    let entries: string[] = [];
    try {
      entries = await fs.readdir(workflowsDir);
    } catch (err) {
      if (!isEnoent(err)) throw err;
      return { root: workspaceRoot, workflows };
    }

    for (const entry of entries) {
      if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) continue;
      const filePath = path.join(workflowsDir, entry);
      const raw = await fs.readFile(filePath, "utf8");
      const workflow = parseWorkflow(raw, filePath);
      workflows.push(workflow);
    }

    return { root: workspaceRoot, workflows };
  }

  /**
   * Returns true if `.github/workflows/` exists and contains at least one
   * .yml / .yaml file.
   */
  static async hasConfig(workspaceRoot: string): Promise<boolean> {
    const fs = await import("node:fs/promises");
    try {
      const entries = await fs.readdir(path.join(workspaceRoot, WORKFLOWS_DIR));
      return entries.some((e) => e.endsWith(".yml") || e.endsWith(".yaml"));
    } catch {
      return false;
    }
  }
}

/**
 * Parse a GitHub Actions workflow YAML source into a `GitHubWorkflow`.
 *
 * Exported for testing.
 */
export function parseWorkflow(source: string, filePath: string): GitHubWorkflow {
  let parsed: unknown;
  try {
    parsed = parseYaml(source);
  } catch (err) {
    throw new AdapterParseError("github-actions", `Failed to parse YAML: ${(err as Error).message}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new AdapterParseError("github-actions", "Workflow file is not an object");
  }

  const wf = parsed as {
    name?: string;
    on?: unknown;
    env?: Record<string, string>;
    concurrency?: { group?: string; "cancel-in-progress"?: boolean };
    permissions?: Record<string, string> | string;
    jobs?: Record<string, unknown>;
  };

  if (!wf.jobs || typeof wf.jobs !== "object") {
    throw new AdapterParseError("github-actions", "Workflow has no 'jobs' key");
  }

  const triggers = parseTriggers(wf.on);

  const jobs = Object.entries(wf.jobs).map(([id, raw]) => ({
    id,
    job: parseJob(raw as Record<string, unknown>)
  }));

  let permissions: Record<string, string> | undefined;
  if (wf.permissions && typeof wf.permissions === "object") {
    permissions = wf.permissions as Record<string, string>;
  }

  return {
    path: filePath,
    name: wf.name ?? path.basename(filePath),
    triggers,
    env: wf.env,
    concurrency: wf.concurrency
      ? {
          group: wf.concurrency.group,
          cancelInProgress: wf.concurrency["cancel-in-progress"]
        }
      : undefined,
    permissions,
    jobs
  };
}

function parseTriggers(on: unknown): GitHubWorkflowTrigger[] {
  if (!on) return [];
  // String form: `on: push`
  if (typeof on === "string") {
    return [{ kind: on }];
  }
  // Array form: `on: [push, pull_request]`
  if (Array.isArray(on)) {
    return on.filter((v): v is string => typeof v === "string").map((kind) => ({ kind }));
  }
  // Object form: `on: { push: { branches: [...] }, ... }`
  if (typeof on === "object") {
    return Object.entries(on as Record<string, unknown>).map(([kind, config]) => {
      const cfg = (config && typeof config === "object" && !Array.isArray(config)
        ? config
        : {}) as Record<string, unknown>;
      const trigger: GitHubWorkflowTrigger = { kind };
      if (Array.isArray(cfg["branches"])) {
        trigger.branches = cfg["branches"].map(String);
      }
      if (Array.isArray(cfg["paths"])) {
        trigger.paths = cfg["paths"].map(String);
      }
      if (Array.isArray(cfg["tags"])) {
        trigger.tags = cfg["tags"].map(String);
      }
      // For schedule triggers, the value is directly an array of { cron: "..." }
      // rather than an object with a `schedule` key.
      const scheduleRaw = kind === "schedule" && Array.isArray(config) ? config : cfg["schedule"];
      if (Array.isArray(scheduleRaw)) {
        trigger.cron = scheduleRaw
          .map((s) => (s && typeof s === "object" ? (s as { cron?: string }).cron : undefined))
          .filter((v): v is string => typeof v === "string");
      }
      if (cfg["inputs"] && typeof cfg["inputs"] === "object") {
        trigger.inputs = Object.fromEntries(
          Object.entries(cfg["inputs"] as Record<string, Record<string, unknown>>).map(([k, v]) => [
            k,
            {
              type: (v["type"] === "boolean"
                ? "boolean"
                : v["type"] === "choice"
                  ? "choice"
                  : v["type"] === "environment"
                    ? "environment"
                    : "string") as "string" | "boolean" | "choice" | "environment",
              description: typeof v["description"] === "string" ? v["description"] : undefined,
              required: v["required"] === true,
              default: typeof v["default"] === "string" || typeof v["default"] === "boolean"
                ? v["default"]
                : v["default"] !== undefined
                  ? String(v["default"])
                  : undefined,
              options: Array.isArray(v["options"])
                ? v["options"].map(String)
                : undefined
            }
          ])
        );
      }
      return trigger;
    });
  }
  return [];
}

function parseJob(raw: Record<string, unknown>): GitHubJob {
  const stepsRaw = Array.isArray(raw["steps"]) ? raw["steps"] : [];
  const steps = stepsRaw.map((s) => parseStep(s as Record<string, unknown>));

  const needs = Array.isArray(raw["needs"])
    ? raw["needs"].map(String)
    : typeof raw["needs"] === "string"
      ? [raw["needs"]]
      : [];

  const runsOn = typeof raw["runs-on"] === "string"
    ? raw["runs-on"]
    : Array.isArray(raw["runs-on"])
      ? raw["runs-on"].map(String)
      : undefined;

  const strategyRaw = raw["strategy"] as
    | { matrix?: Record<string, unknown>; "fail-fast"?: boolean; "max-parallel"?: number }
    | undefined;

  const matrix = strategyRaw?.matrix;
  const matrixNormalized = matrix && typeof matrix === "object"
    ? Object.fromEntries(
        Object.entries(matrix as Record<string, unknown>)
          .filter(([, v]) => Array.isArray(v))
          .map(([k, v]) => [k, (v as unknown[]).map(String)])
      )
    : undefined;

  return {
    name: typeof raw["name"] === "string" ? raw["name"] : undefined,
    runsOn,
    needs: needs.length > 0 ? needs : undefined,
    steps,
    env: (raw["env"] as Record<string, string> | undefined) ?? undefined,
    strategy: strategyRaw
      ? {
          matrix: matrixNormalized,
          failFast: strategyRaw["fail-fast"],
          maxParallel: strategyRaw["max-parallel"]
        }
      : undefined,
    timeoutMinutes: typeof raw["timeout-minutes"] === "number" ? raw["timeout-minutes"] : undefined,
    if: typeof raw["if"] === "string" ? raw["if"] : undefined,
    permissions: (raw["permissions"] as Record<string, string> | undefined) ?? undefined
  };
}

function parseStep(raw: Record<string, unknown>): GitHubJobStep {
  return {
    name: typeof raw["name"] === "string" ? raw["name"] : undefined,
    uses: typeof raw["uses"] === "string" ? raw["uses"] : undefined,
    run: typeof raw["run"] === "string" ? raw["run"] : undefined,
    with: (raw["with"] as GitHubJobStep["with"]) ?? undefined,
    if: typeof raw["if"] === "string" ? raw["if"] : undefined,
    env: (raw["env"] as Record<string, string> | undefined) ?? undefined,
    id: typeof raw["id"] === "string" ? raw["id"] : undefined,
    continueOnError: raw["continue-on-error"] === true,
    timeoutMinutes: typeof raw["timeout-minutes"] === "number" ? raw["timeout-minutes"] : undefined
  };
}

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "ENOENT";
}
