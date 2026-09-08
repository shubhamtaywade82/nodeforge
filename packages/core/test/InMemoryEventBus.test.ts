/**
 * Tests for the InMemoryEventBus.
 */

import { describe, expect, it, vi } from "vitest";
import { InMemoryEventBus } from "../src/events/InMemoryEventBus.js";
import type { WorkspaceProfile } from "@nodeforge/contracts";

const sampleProfile: WorkspaceProfile = {
  root: "/test",
  runtime: "node",
  packageManager: "npm",
  typescript: true,
  docker: false,
  kubernetes: false,
  githubActions: false,
  monorepo: "none",
  workspacePackages: [],
  signals: { files: {}, configFiles: {} }
};

describe("InMemoryEventBus", () => {
  it("delivers events to matching subscribers", () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();
    bus.subscribe("workspace.profiled", handler);

    bus.publish({ type: "workspace.profiled", profile: sampleProfile });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ type: "workspace.profiled", profile: sampleProfile });
  });

  it("does not deliver events to non-matching subscribers", () => {
    const bus = new InMemoryEventBus();
    const profileHandler = vi.fn();
    const diagHandler = vi.fn();
    bus.subscribe("workspace.profiled", profileHandler);
    bus.subscribe("diagnostics.cleared", diagHandler);

    bus.publish({ type: "workspace.profiled", profile: sampleProfile });

    expect(profileHandler).toHaveBeenCalledTimes(1);
    expect(diagHandler).not.toHaveBeenCalled();
  });

  it("unsubscribe removes the handler", () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();
    const unsub = bus.subscribe("workspace.profiled", handler);

    bus.publish({ type: "workspace.profiled", profile: sampleProfile });
    unsub();
    bus.publish({ type: "workspace.profiled", profile: sampleProfile });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not throw when a handler throws", () => {
    const bus = new InMemoryEventBus();
    bus.subscribe("workspace.profiled", () => {
      throw new Error("boom");
    });
    const goodHandler = vi.fn();
    bus.subscribe("workspace.profiled", goodHandler);

    // Suppress expected console.error from the bus error handler.
    const original = console.error;
    console.error = vi.fn();
    try {
      bus.publish({ type: "workspace.profiled", profile: sampleProfile });
    } finally {
      console.error = original;
    }

    // The good handler should still have been called even though the first threw.
    expect(goodHandler).toHaveBeenCalledTimes(1);
  });

  it("supports async handlers", async () => {
    const bus = new InMemoryEventBus();
    let observed = false;
    bus.subscribe("workspace.profiled", async () => {
      await new Promise((r) => setTimeout(r, 1));
      observed = true;
    });

    bus.publish({ type: "workspace.profiled", profile: sampleProfile });
    // Wait a tick for the microtask queue.
    await new Promise((r) => setTimeout(r, 10));

    expect(observed).toBe(true);
  });
});
