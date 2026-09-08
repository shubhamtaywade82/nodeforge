/**
 * WorkspaceManager — owns the cached `WorkspaceProfile` for the current
 * workspace root and is the single writer of `workspace.profiled` events.
 *
 * The UI calls `analyze()` to refresh; everything else reads from cache
 * via `current()`.
 */

import type { EventBus, WorkspaceProfile } from "@nodeforge/contracts";
import type { FilesystemReader } from "@nodeforge/core";
import { detectWorkspaceProfile } from "@nodeforge/core";
import type { ProcessRunner } from "@nodeforge/runner";

export class WorkspaceManager {
  private currentProfile: WorkspaceProfile | undefined;
  private analyzing: Promise<WorkspaceProfile> | undefined;

  constructor(
    private readonly reader: FilesystemReader,
    private readonly runner: ProcessRunner,
    private readonly bus: EventBus
  ) {}

  /** Returns the most recent cached profile, if any. */
  current(): WorkspaceProfile | undefined {
    return this.currentProfile;
  }

  /**
   * Run detection for `root`. Idempotent: concurrent calls coalesce.
   * On success, publishes `workspace.profiled`.
   */
  async analyze(root: string): Promise<WorkspaceProfile> {
    if (this.analyzing) return this.analyzing;
    this.analyzing = (async () => {
      const profile = await detectWorkspaceProfile(root, this.reader);
      this.currentProfile = profile;
      this.bus.publish({ type: "workspace.profiled", profile });
      this.analyzing = undefined;
      return profile;
    })();
    try {
      return await this.analyzing;
    } finally {
      this.analyzing = undefined;
    }
  }

  /** Invalidate the cache (e.g. after a major config change). */
  invalidate(root: string): void {
    if (this.currentProfile?.root === root) {
      this.currentProfile = undefined;
      this.bus.publish({ type: "workspace.profileInvalidated", root });
    }
  }
}
