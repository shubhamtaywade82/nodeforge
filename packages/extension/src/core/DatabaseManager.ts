/**
 * DatabaseManager — orchestrates Prisma / Drizzle adapters based on the
 * detected `WorkspaceProfile`.
 *
 *   orm === "prisma"  → PrismaAdapter
 *   orm === "drizzle" → DrizzleAdapter
 *   otherwise         → no adapter
 *
 * The manager publishes results via the `DatabaseViewProvider.setSchema()`
 * method (called by the extension), since the contracts don't yet have a
 * dedicated `database.schemaDetected` event.
 */

import type { EventBus, WorkspaceProfile, DatabaseSchema } from "@nodeforge/contracts";
import { PrismaAdapter } from "@nodeforge/adapter-prisma";
import { DrizzleAdapter } from "@nodeforge/adapter-drizzle";

export class DatabaseManager {
  private profile: WorkspaceProfile | undefined;
  private prisma: PrismaAdapter | undefined;
  private drizzle: DrizzleAdapter | undefined;
  private currentSchema: DatabaseSchema | undefined;

  constructor(private readonly bus: EventBus) {
    this.bus.subscribe("workspace.profiled", (e) => {
      this.onProfileChanged(e.profile);
    });
  }

  /** Returns true if either Prisma or Drizzle is enabled. */
  isEnabled(): boolean {
    return this.prisma !== undefined || this.drizzle !== undefined;
  }

  /** Returns the last detected schema, if any. */
  getCurrent(): DatabaseSchema | undefined {
    return this.currentSchema;
  }

  /** Update the cached profile and reconfigure the adapter. */
  onProfileChanged(profile: WorkspaceProfile): void {
    this.profile = profile;
    this.prisma = profile.orm === "prisma" ? new PrismaAdapter() : undefined;
    this.drizzle = profile.orm === "drizzle" ? new DrizzleAdapter() : undefined;
  }

  /** Run the enabled database adapter. Returns undefined if no ORM detected. */
  async detect(): Promise<DatabaseSchema | undefined> {
    if (!this.profile) return undefined;
    if (this.prisma) {
      try {
        const schema = await this.prisma.detect(this.profile.root);
        this.currentSchema = schema;
        return schema;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[nodeforge:database-manager] Prisma detect failed", err);
        return undefined;
      }
    }
    if (this.drizzle) {
      try {
        const schema = await this.drizzle.detect(this.profile.root);
        this.currentSchema = schema;
        return schema;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[nodeforge:database-manager] Drizzle detect failed", err);
        return undefined;
      }
    }
    return undefined;
  }
}
