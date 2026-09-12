/**
 * NodeForge event bus contract.
 *
 * Every interesting state change in the system flows through this bus. The
 * UI subscribes to render sidebar/Problems updates; the agent subscribes
 * (via MCP bridge) to react to changes.
 *
 * This is a pure type contract — concrete implementations live in `packages/core`.
 */

import type { DiagnosticSnapshot } from "./diagnostic.js";
import type { WorkspaceProfile } from "./workspace.js";
import type { TestRunResult } from "./test.js";
import type { RuntimeEvent } from "./runtime.js";
import type { GitState } from "./git.js";
import type { DependencyReport } from "./dependency.js";
import type { DependencyGraphAnalysis } from "./dependency-graph.js";

export type NodeForgeEvent =
  | { type: "workspace.profiled"; profile: WorkspaceProfile }
  | { type: "workspace.profileInvalidated"; root: string }
  | { type: "diagnostics.snapshot"; snapshot: DiagnosticSnapshot }
  | { type: "diagnostics.cleared"; source: string }
  | { type: "test.runCompleted"; result: TestRunResult }
  | { type: "runtime.event"; event: RuntimeEvent }
  | { type: "runtime.processStarted"; pid: number; name: string }
  | { type: "runtime.processExited"; pid: number; exitCode: number | null; cancelled: boolean }
  | { type: "git.stateChanged"; state: GitState }
  | { type: "trust.changed"; trusted: boolean }
  | { type: "dependencies.reported"; report: DependencyReport }
  | { type: "dependencyGraph.analyzed"; analysis: DependencyGraphAnalysis };

export type NodeForgeEventHandler<E extends NodeForgeEvent = NodeForgeEvent> = (event: E) => void | Promise<void>;

/** Minimal pub/sub surface that any NodeForge event bus must implement. */
export interface EventBus {
  publish(event: NodeForgeEvent): void;
  subscribe<E extends NodeForgeEvent["type"]>(
    type: E,
    handler: (event: Extract<NodeForgeEvent, { type: E }>) => void | Promise<void>
  ): () => void;
}

/** A no-op bus for tests that don't care about events. */
export const NULL_EVENT_BUS: EventBus = {
  publish: () => undefined,
  subscribe: () => () => undefined,
};
