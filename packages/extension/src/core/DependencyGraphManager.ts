import type { DependencyGraphAnalysis, EventBus, WorkspaceProfile } from "@nodeforge/contracts";
import { DependencyGraphAdapter } from "@nodeforge/adapter-dependency-graph";

export class DependencyGraphManager {
  private profile: WorkspaceProfile | undefined;
  private adapter = new DependencyGraphAdapter();
  private current: DependencyGraphAnalysis | undefined;

  constructor(private readonly bus: EventBus) {
    this.bus.subscribe("workspace.profiled", (e) => {
      this.onProfileChanged(e.profile);
    });
  }

  getCurrent(): DependencyGraphAnalysis | undefined {
    return this.current;
  }

  onProfileChanged(profile: WorkspaceProfile): void {
    this.profile = profile;
  }

  async analyze(signal?: AbortSignal): Promise<DependencyGraphAnalysis | undefined> {
    if (!this.profile) return undefined;
    try {
      this.current = await this.adapter.analyze(this.profile.root, signal);
      this.bus.publish({ type: "dependencyGraph.analyzed", analysis: this.current });
      return this.current;
    } catch (err) {
      if (signal?.aborted) return undefined;
      // eslint-disable-next-line no-console
      console.error("[nodeforge:dependency-graph-manager] analyze failed", err);
      return undefined;
    }
  }
}
