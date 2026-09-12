/**
 * DependencyManager — wraps the DependencyAdapter so the UI doesn't have to
 * manage raw adapter instances.
 *
 * Detects which package manager to use from the workspace profile's
 * lockfile (already inferred by the detector) and runs `npm audit --json` /
 * `pnpm audit --json` plus `npm outdated --json`.
 */

import type { EventBus, DependencyReport, WorkspaceProfile } from "@nodeforge/contracts";
import { DependencyAdapter } from "@nodeforge/adapter-dependencies";
import { ProcessRunner } from "@nodeforge/runner";

export class DependencyManager {
  private profile: WorkspaceProfile | undefined;
  private adapter: DependencyAdapter | undefined;
  private currentReport: DependencyReport | undefined;

  constructor(
    private readonly runner: ProcessRunner,
    private readonly bus: EventBus
  ) {
    this.bus.subscribe("workspace.profiled", (e) => {
      this.onProfileChanged(e.profile);
    });
  }

  /** Returns the last captured dependency report, if any. */
  getCurrent(): DependencyReport | undefined {
    return this.currentReport;
  }

  /** Update the cached profile and reconfigure the adapter. */
  onProfileChanged(profile: WorkspaceProfile): void {
    this.profile = profile;
    if (profile.packageManager === "npm" || profile.packageManager === "pnpm" || profile.packageManager === "yarn") {
      this.adapter = new DependencyAdapter(this.runner, {
        packageManager: profile.packageManager
      });
    } else {
      // Unknown PM — default to npm.
      this.adapter = new DependencyAdapter(this.runner, { packageManager: "npm" });
    }
  }

  /** Run audit + outdated and return the combined report. */
  async audit(): Promise<DependencyReport | undefined> {
    if (!this.profile || !this.adapter) return undefined;
    try {
      const result = await this.adapter.run(this.profile.root);
      // Also fetch outdated (best-effort — may fail on some package managers).
      let outdated: DependencyReport["outdated"] = [];
      try {
        outdated = await this.adapter.outdated(this.profile.root);
      } catch {
        // npm outdated may exit non-zero even with output; ignore.
      }
      this.currentReport = {
        ...result.report,
        outdated
      };
      this.bus.publish({ type: "dependencies.reported", report: this.currentReport });
      return this.currentReport;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[nodeforge:dependency-manager] audit failed", err);
      return undefined;
    }
  }
}
