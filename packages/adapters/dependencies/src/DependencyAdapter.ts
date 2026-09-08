/**
 * Dependency adapter.
 *
 * Wraps `npm audit --json` or `pnpm audit --json` and normalizes the output
 * into the `DependencyFinding[]` contract. Falls back gracefully when audit
 * is not available or returns no findings.
 *
 * The npm audit JSON format (auditReportVersion 2):
 *
 *   {
 *     "vulnerabilities": {
 *       "lodash": {
 *         "name": "lodash",
 *         "severity": "high",
 *         "isDirect": true,
 *         "via": [
 *           {
 *             "title": "Prototype Pollution",
 *             "url": "https://github.com/advisories/GHSA-...",
 *             "severity": "high",
 *             "range": "<4.17.21"
 *           }
 *         ],
 *         "fixAvailable": { "name": "lodash", "version": "4.17.21" }
 *       }
 *     },
 *     "metadata": {
 *       "vulnerabilities": { "info": 0, "low": 0, "moderate": 0, "high": 1, "critical": 0, "total": 1 }
 *     }
 *   }
 *
 * pnpm audit --json produces a different shape (an array of advisory objects).
 * We support both formats via a discriminated parse.
 */

import * as path from "node:path";
import {
  AdapterParseError,
  FileNotFoundError,
  type CommandRequest,
  type DependencyFinding,
  type DependencyReport,
  type DependencySeverity
} from "@nodeforge/contracts";
import { ProcessRunner, resolveExecutable } from "@nodeforge/runner";

export interface DependencyAdapterOptions {
  /** Override the package manager binary. Defaults to detection from lockfile. */
  packageManager?: "npm" | "pnpm" | "yarn";
  /** Hard timeout for the audit run, in ms. Defaults to 60_000. */
  timeoutMs?: number;
}

export interface AuditRunResult {
  report: DependencyReport;
  rawStdout: string;
  rawStderr: string;
  durationMs: number;
  exitCode: number | null;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export class DependencyAdapter {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly options: DependencyAdapterOptions = {}
  ) {}

  /**
   * Run `npm audit --json` or `pnpm audit --json` for the given workspace root
   * and return normalized findings.
   *
   * Resolution order for the package manager:
   *   1. options.packageManager (if set)
   *   2. Lockfile presence: pnpm-lock.yaml → pnpm, yarn.lock → yarn, package-lock.json → npm
   *   3. Fallback: npm
   */
  async run(workspaceRoot: string, signal?: AbortSignal): Promise<AuditRunResult> {
    const pm = this.options.packageManager ?? (await detectPackageManager(workspaceRoot));
    const binary = await resolveBinary(pm);
    if (!binary) {
      throw new FileNotFoundError(pm);
    }

    const args = pm === "yarn" ? ["audit", "--json"] : ["audit", "--json"];
    const request: CommandRequest = {
      command: binary,
      args,
      cwd: workspaceRoot,
      timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal
    };

    // npm audit exits 0 if no vulns, 1+ if vulns present. We treat any exit
    // code as "audit completed" and parse the JSON output.
    const result = await this.runner.run(request);

    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";

    const findings = parseAuditJson(stdout, pm);
    const report: DependencyReport = {
      root: workspaceRoot,
      capturedAt: Date.now(),
      findings,
      outdated: []
    };

    return {
      report,
      rawStdout: stdout,
      rawStderr: stderr,
      durationMs: result.durationMs,
      exitCode: result.exitCode
    };
  }

  /**
   * Run `npm outdated --json` or `pnpm outdated --json` and return normalized
   * entries.
   */
  async outdated(workspaceRoot: string, signal?: AbortSignal): Promise<DependencyReport["outdated"]> {
    const pm = this.options.packageManager ?? (await detectPackageManager(workspaceRoot));
    const binary = await resolveBinary(pm);
    if (!binary) {
      throw new FileNotFoundError(pm);
    }

    const args = ["outdated", "--json"];
    const request: CommandRequest = {
      command: binary,
      args,
      cwd: workspaceRoot,
      timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal
    };

    const result = await this.runner.run(request);
    return parseOutdatedJson(result.stdout ?? "", pm);
  }
}

async function detectPackageManager(root: string): Promise<"npm" | "pnpm" | "yarn"> {
  const fs = await import("node:fs/promises");
  try {
    await fs.access(path.join(root, "pnpm-lock.yaml"));
    return "pnpm";
  } catch {
    // continue
  }
  try {
    await fs.access(path.join(root, "yarn.lock"));
    return "yarn";
  } catch {
    // continue
  }
  return "npm";
}

async function resolveBinary(pm: "npm" | "pnpm" | "yarn"): Promise<string | undefined> {
  // npm and yarn are usually on PATH; pnpm may be via corepack.
  return resolveExecutable(pm);
}

// JSON shape from `npm audit --json` (auditReportVersion 2).
interface NpmAuditResult {
  auditReportVersion?: number;
  vulnerabilities?: Record<string, NpmVulnerability>;
  metadata?: {
    vulnerabilities?: Record<string, number>;
  };
}

interface NpmVulnerability {
  name: string;
  severity: "info" | "low" | "moderate" | "high" | "critical";
  isDirect?: boolean;
  via?: Array<NpmVia | string>;
  range?: string;
  effects?: string[];
  fixAvailable?:
    | boolean
    | {
        name: string;
        version: string;
        isSemVerMajor?: boolean;
      };
}

interface NpmVia {
  title?: string;
  url?: string;
  severity?: string;
  range?: string;
  source?: number;
  name?: string;
}

// JSON shape from `pnpm audit --json` (an array of advisory objects).
interface PnpmAuditResultItem {
  advisory?: {
    id?: number;
    title?: string;
    url?: string;
    severity?: string;
    module_name?: string;
    vulnerable_versions?: string;
    patched_versions?: string;
  };
  resolution?: {
    path?: string;
  };
}

/**
 * Parse `npm audit --json` or `pnpm audit --json` stdout into normalized
 * `DependencyFinding[]`. Exported for testing.
 */
export function parseAuditJson(stdout: string, pm: "npm" | "pnpm" | "yarn"): DependencyFinding[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new AdapterParseError("dependencies", `Failed to parse JSON: ${(err as Error).message}`);
  }

  if (pm === "pnpm") {
    if (!Array.isArray(parsed)) {
      throw new AdapterParseError("dependencies", "pnpm audit: expected an array");
    }
    return parsePnpmAudit(parsed as PnpmAuditResultItem[]);
  }

  // npm and yarn both use the npm audit format (yarn 4+ uses npm-style).
  return parseNpmAudit(parsed as NpmAuditResult);
}

function parseNpmAudit(result: NpmAuditResult): DependencyFinding[] {
  const out: DependencyFinding[] = [];
  const vulns = result.vulnerabilities ?? {};
  for (const [pkgName, v] of Object.entries(vulns)) {
    const severity = mapSeverity(v.severity);
    // Pick the first advisory URL from via[] for the advisory id.
    let advisory: string | undefined;
    let title: string | undefined;
    let url: string | undefined;
    if (Array.isArray(v.via)) {
      for (const via of v.via) {
        if (typeof via === "object" && via !== null && "url" in via) {
          const nv = via as NpmVia;
          advisory = extractAdvisoryId(nv.url);
          title = nv.title ?? `${pkgName} vulnerability`;
          url = nv.url;
          break;
        }
      }
    }
    // Determine the recommended fix version.
    let recommended: string | undefined;
    if (typeof v.fixAvailable === "object" && v.fixAvailable !== null) {
      recommended = v.fixAvailable.version;
    }

    out.push({
      packageName: pkgName,
      installed: v.range ?? "unknown",
      recommended,
      severity,
      advisory,
      title: title ?? `${pkgName} has a ${v.severity} severity vulnerability`,
      url,
      dependencyType: v.isDirect ? "prod" : "dev"
    });
  }
  return out;
}

function parsePnpmAudit(items: PnpmAuditResultItem[]): DependencyFinding[] {
  const out: DependencyFinding[] = [];
  for (const item of items) {
    const adv = item.advisory;
    if (!adv) continue;
    const severity = mapSeverity((adv.severity ?? "moderate").toLowerCase());
    out.push({
      packageName: adv.module_name ?? "unknown",
      installed: adv.vulnerable_versions ?? "unknown",
      recommended: adv.patched_versions,
      severity,
      advisory: adv.id !== undefined ? `GHSA-${adv.id}` : undefined,
      title: adv.title ?? `${adv.module_name ?? "unknown"} vulnerability`,
      url: adv.url,
      dependencyType: "prod" // pnpm doesn't expose this in audit output
    });
  }
  return out;
}

/**
 * Parse `npm outdated --json` / `pnpm outdated --json` output.
 *
 * npm outdated format:
 *   {
 *     "lodash": { "current": "4.17.20", "wanted": "4.17.20", "latest": "4.17.21", "dependent": "fixture", "type": "dependencies" }
 *   }
 *
 * pnpm outdated format is an array with similar fields.
 */
export function parseOutdatedJson(stdout: string, pm: "npm" | "pnpm" | "yarn"): DependencyReport["outdated"] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  const out: DependencyReport["outdated"] = [];
  if (pm === "pnpm" && Array.isArray(parsed)) {
    for (const item of parsed as Array<Record<string, unknown>>) {
      const packageName = String(item["name"] ?? "");
      const current = String(item["current"] ?? item["version"] ?? "");
      const wanted = String(item["wanted"] ?? current);
      const latest = String(item["latest"] ?? current);
      out.push({
        packageName,
        current,
        wanted,
        latest,
        diff: diffKind(current, latest),
        dependencyType: "prod"
      });
    }
    return out;
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, Record<string, unknown>>;
    for (const [packageName, info] of Object.entries(obj)) {
      const current = String(info["current"] ?? "");
      const wanted = String(info["wanted"] ?? current);
      const latest = String(info["latest"] ?? current);
      const depType = String(info["type"] ?? "dependencies");
      out.push({
        packageName,
        current,
        wanted,
        latest,
        diff: diffKind(current, latest),
        dependencyType: depType === "devDependencies" ? "dev" : "prod"
      });
    }
  }
  return out;
}

function mapSeverity(s: string): DependencySeverity {
  switch (s) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "moderate":
      return "moderate";
    case "low":
    case "info":
      return "low";
    default:
      return "low";
  }
}

function extractAdvisoryId(url?: string): string | undefined {
  if (!url) return undefined;
  // GHSA URLs end with the advisory id, e.g. https://github.com/advisories/GHSA-xxxx-xxxx-xxxx
  const match = /\/(GHSA-[a-z0-9-]+)$/i.exec(url);
  return match ? match[1] : undefined;
}

function diffKind(current: string, latest: string): "patch" | "minor" | "major" | "none" {
  if (current === latest) return "none";
  const cur = current.split(".").map((n) => parseInt(n, 10) || 0);
  const lat = latest.split(".").map((n) => parseInt(n, 10) || 0);
  if (cur.length < 3 || lat.length < 3) return "patch";
  if (cur[0] !== lat[0]) return "major";
  if (cur[1] !== lat[1]) return "minor";
  return "patch";
}
