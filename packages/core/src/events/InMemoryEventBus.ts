/**
 * In-memory event bus implementation.
 *
 * Synchronous dispatch with async-safe handler invocation. This is enough
 * for v0.0.x — we will add debouncing / throttling / backpressure later.
 */

import type { EventBus, NodeForgeEvent } from "@nodeforge/contracts";

type AnyHandler = (event: NodeForgeEvent) => void | Promise<void>;

export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Map<string, Set<AnyHandler>>();

  publish(event: NodeForgeEvent): void {
    const set = this.handlers.get(event.type);
    if (!set) return;
    for (const handler of set) {
      // Wrap so both sync throws and async rejections are caught.
      try {
        void Promise.resolve(handler(event)).catch((err) => {
          // eslint-disable-next-line no-console
          console.error(`[nodeforge:event-bus] handler for "${event.type}" threw:`, err);
        });
      } catch (err) {
        // Sync throw inside the handler — swallow to protect the bus.
        // eslint-disable-next-line no-console
        console.error(`[nodeforge:event-bus] handler for "${event.type}" threw (sync):`, err);
      }
    }
  }

  subscribe<E extends NodeForgeEvent["type"]>(
    type: E,
    handler: (event: Extract<NodeForgeEvent, { type: E }>) => void | Promise<void>
  ): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as AnyHandler);
    return () => {
      const current = this.handlers.get(type);
      if (!current) return;
      current.delete(handler as AnyHandler);
      if (current.size === 0) this.handlers.delete(type);
    };
  }
}
