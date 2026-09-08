/**
 * Dependency intelligence contract.
 *
 * Produced by `packages/adapters/dependencies`. Vulnerability data is
 * sourced from `npm audit`, OSV, or GitHub Advisory — but always normalized
 * to this shape so the UI and agent don't care which scanner ran.
 */

export type DependencySeverity = "low" | "moderate" | "high" | "critical";

export interface DependencyFinding {
  packageName: string;
  /** Installed version. */
  installed: string;
  /** Recommended fixed version, if known. */
  recommended?: string;
  severity: DependencySeverity;
  /** Advisory identifier, e.g. `GHSA-xxxx-xxxx-xxxx` or `CVE-2024-xxxx`. */
  advisory?: string;
  /** Short title. */
  title: string;
  /** Optional URL to the advisory page. */
  url?: string;
  /** Which dependency tree the package lives in. */
  dependencyType: "prod" | "dev" | "optional" | "peer" | "workspace";
}

export interface OutdatedEntry {
  packageName: string;
  current: string;
  wanted: string;
  latest: string;
  /** Semver diff type, e.g. `minor`, `major`. */
  diff: "patch" | "minor" | "major" | "none";
  dependencyType: "prod" | "dev" | "optional" | "peer";
}

export interface DependencyReport {
  root: string;
  capturedAt: number;
  findings: DependencyFinding[];
  outdated: OutdatedEntry[];
}
