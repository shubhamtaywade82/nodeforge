import type { DependencyGraphAnalysis, DependencyReport, WorkspaceProfile } from "@nodeforge/contracts";
import type { NodeForgeContext } from "./NodeForgeContext.js";

export interface WorkspaceSnapshot {
  root: string;
  capturedAt: number;
  profile: WorkspaceProfile;
  dependencySummary?: {
    vulnerabilities: number;
    outdated: number;
    critical: number;
    high: number;
  };
  graphSummary?: {
    unused: number;
    circular: number;
    missing: number;
  };
}

export async function buildWorkspaceSnapshot(
  ctx: NodeForgeContext,
  cached?: {
    dependencyReport?: DependencyReport;
    graphAnalysis?: DependencyGraphAnalysis;
  }
): Promise<WorkspaceSnapshot> {
  const profile = await ctx.getProfile();
  const report = cached?.dependencyReport;
  const graph = cached?.graphAnalysis;

  const snapshot: WorkspaceSnapshot = {
    root: ctx.getRoot(),
    capturedAt: Date.now(),
    profile
  };

  if (report) {
    snapshot.dependencySummary = {
      vulnerabilities: report.findings.length,
      outdated: report.outdated.length,
      critical: report.findings.filter((f) => f.severity === "critical").length,
      high: report.findings.filter((f) => f.severity === "high").length
    };
  }

  if (graph) {
    snapshot.graphSummary = {
      unused: graph.unused.length,
      circular: graph.circular.length,
      missing: graph.missing.length
    };
  }

  return snapshot;
}

export function formatSnapshotForPrompt(snapshot: WorkspaceSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}
