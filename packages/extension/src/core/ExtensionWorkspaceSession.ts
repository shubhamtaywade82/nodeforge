import type { DependencyGraphAnalysis, DependencyReport, EventBus } from "@nodeforge/contracts";
import {
  NodeForgeContext,
  buildWorkspaceSnapshot,
  formatSnapshotForPrompt,
  type WorkspaceSnapshot
} from "@nodeforge/agent";

export class ExtensionWorkspaceSession {
  private context: NodeForgeContext | undefined;
  private dependencyReport: DependencyReport | undefined;
  private graphAnalysis: DependencyGraphAnalysis | undefined;
  private snapshot: WorkspaceSnapshot | undefined;

  constructor(private readonly bus: EventBus) {
    this.bus.subscribe("dependencies.reported", (e) => {
      this.dependencyReport = e.report;
    });
    this.bus.subscribe("dependencyGraph.analyzed", (e) => {
      this.graphAnalysis = e.analysis;
    });
  }

  bindRoot(root: string): NodeForgeContext {
    if (!this.context || this.context.getRoot() !== root) {
      this.context = new NodeForgeContext(root);
      this.snapshot = undefined;
    }
    return this.context;
  }

  getContext(): NodeForgeContext | undefined {
    return this.context;
  }

  getDependencyReport(): DependencyReport | undefined {
    return this.dependencyReport;
  }

  getGraphAnalysis(): DependencyGraphAnalysis | undefined {
    return this.graphAnalysis;
  }

  setDependencyReport(report: DependencyReport | undefined): void {
    this.dependencyReport = report;
    if (report) {
      this.bus.publish({ type: "dependencies.reported", report });
    }
  }

  setGraphAnalysis(analysis: DependencyGraphAnalysis | undefined): void {
    this.graphAnalysis = analysis;
    if (analysis) {
      this.bus.publish({ type: "dependencyGraph.analyzed", analysis });
    }
  }

  async refreshSnapshot(): Promise<WorkspaceSnapshot | undefined> {
    if (!this.context) return undefined;
    this.snapshot = await buildWorkspaceSnapshot(this.context, {
      dependencyReport: this.dependencyReport,
      graphAnalysis: this.graphAnalysis
    });
    return this.snapshot;
  }

  async snapshotJson(): Promise<string | undefined> {
    const snap = await this.refreshSnapshot();
    return snap ? formatSnapshotForPrompt(snap) : undefined;
  }
}
