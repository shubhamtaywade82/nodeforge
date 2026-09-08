/**
 * Tests for ProcessManager — manages long-lived processes.
 *
 * These tests spawn real `node -e` processes that emit output and exit,
 * so we can verify the manager correctly:
 *   - captures stdout/stderr lines
 *   - publishes RuntimeEvent on each line
 *   - publishes runtime.processStarted / runtime.processExited
 *   - converts error-pattern lines into runtime events with level "error"
 *   - exposes list()/running()/get()/stop()
 */

import { describe, expect, it, vi } from "vitest";
import { ProcessManager } from "../../src/runtime/ProcessManager.js";
import { InMemoryEventBus } from "../../src/events/InMemoryEventBus.js";

const NODE = process.execPath;

describe("ProcessManager", () => {
  it("starts a process, captures pid, publishes processStarted", async () => {
    const bus = new InMemoryEventBus();
    const startedHandler = vi.fn();
    bus.subscribe("runtime.processStarted", startedHandler);

    const manager = new ProcessManager(bus);
    const started = manager.start({
      name: "echo-test",
      command: NODE,
      args: ["-e", "process.stdout.write('hi\\n'); process.exit(0);"],
      cwd: process.cwd()
    });

    expect(started.id).toBeTruthy();
    expect(started.name).toBe("echo-test");
    expect(typeof started.pid).toBe("number");

    // Wait for process to exit + handlers to flush.
    await waitForExit(manager, started.id);

    expect(startedHandler).toHaveBeenCalledTimes(1);
    expect(startedHandler).toHaveBeenCalledWith({
      type: "runtime.processStarted",
      pid: started.pid,
      name: "echo-test"
    });
  });

  it("captures stdout lines as runtime.event", async () => {
    const bus = new InMemoryEventBus();
    const events: Array<{ level: string; message: string }> = [];
    bus.subscribe("runtime.event", (e) => {
      events.push({ level: e.event.level, message: e.event.message });
    });

    const manager = new ProcessManager(bus);
    const started = manager.start({
      name: "stdout-test",
      command: NODE,
      args: ["-e", "process.stdout.write('line1\\nline2\\n'); process.exit(0);"],
      cwd: process.cwd()
    });

    await waitForExit(manager, started.id);

    // Filter to just stdout lines (level "info", source "stdout-test").
    const stdoutEvents = events.filter((e) => e.level === "info");
    expect(stdoutEvents.length).toBeGreaterThanOrEqual(2);
    expect(stdoutEvents.map((e) => e.message)).toEqual(expect.arrayContaining(["line1", "line2"]));
  });

  it("captures stderr lines with warn level", async () => {
    const bus = new InMemoryEventBus();
    const events: Array<{ level: string; message: string }> = [];
    bus.subscribe("runtime.event", (e) => {
      events.push({ level: e.event.level, message: e.event.message });
    });

    const manager = new ProcessManager(bus);
    const started = manager.start({
      name: "stderr-test",
      command: NODE,
      args: ["-e", "process.stderr.write('warning line\\n'); process.exit(0);"],
      cwd: process.cwd()
    });

    await waitForExit(manager, started.id);

    const stderrEvents = events.filter((e) => e.level === "warn" && e.message === "warning line");
    expect(stderrEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("publishes runtime.processExited on clean exit with code 0", async () => {
    const bus = new InMemoryEventBus();
    const exitedHandler = vi.fn();
    bus.subscribe("runtime.processExited", exitedHandler);

    const manager = new ProcessManager(bus);
    const started = manager.start({
      name: "clean-exit",
      command: NODE,
      args: ["-e", "process.exit(0);"],
      cwd: process.cwd()
    });

    await waitForExit(manager, started.id);

    expect(exitedHandler).toHaveBeenCalledTimes(1);
    const call = exitedHandler.mock.calls[0]![0];
    expect(call.exitCode).toBe(0);
    expect(call.cancelled).toBe(false);
  });

  it("publishes runtime.processExited on non-zero exit", async () => {
    const bus = new InMemoryEventBus();
    const exitedHandler = vi.fn();
    bus.subscribe("runtime.processExited", exitedHandler);
    const runtimeEventHandler = vi.fn();
    bus.subscribe("runtime.event", runtimeEventHandler);

    const manager = new ProcessManager(bus);
    const started = manager.start({
      name: "crash-exit",
      command: NODE,
      args: ["-e", "process.exit(3);"],
      cwd: process.cwd()
    });

    await waitForExit(manager, started.id);

    expect(exitedHandler).toHaveBeenCalledTimes(1);
    const call = exitedHandler.mock.calls[0]![0];
    expect(call.exitCode).toBe(3);

    // Non-zero exit should also emit a runtime.event with level "error".
    const errorEvents = runtimeEventHandler.mock.calls
      .map((c) => c[0])
      .filter((e) => e.event.level === "error" && e.event.message.includes("exited with code 3"));
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("detects runtime error patterns in stdout and emits error-level events", async () => {
    const bus = new InMemoryEventBus();
    const events: Array<{ level: string; message: string }> = [];
    bus.subscribe("runtime.event", (e) => {
      events.push({ level: e.event.level, message: e.event.message });
    });

    const manager = new ProcessManager(bus);
    const started = manager.start({
      name: "error-line",
      command: NODE,
      args: [
        "-e",
        "process.stdout.write('Error: something went wrong\\n'); process.exit(0);"
      ],
      cwd: process.cwd()
    });

    await waitForExit(manager, started.id);

    // The 'Error: ...' line should appear as an error-level event.
    const errorEvents = events.filter(
      (e) => e.level === "error" && e.message.includes("something went wrong")
    );
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("stop() sends SIGTERM and marks the process as cancelled", async () => {
    const bus = new InMemoryEventBus();
    const exitedHandler = vi.fn();
    bus.subscribe("runtime.processExited", exitedHandler);

    const manager = new ProcessManager(bus);
    const started = manager.start({
      name: "long-running",
      command: NODE,
      args: ["-e", "setInterval(() => {}, 1000);"],
      cwd: process.cwd()
    });

    // Give it a moment to start.
    await new Promise((r) => setTimeout(r, 50));

    expect(manager.running().length).toBe(1);
    const stopped = manager.stop(started.id);
    expect(stopped).toBe(true);

    await waitForExit(manager, started.id);

    expect(exitedHandler).toHaveBeenCalledTimes(1);
    const call = exitedHandler.mock.calls[0]![0];
    expect(call.cancelled).toBe(true);
  });

  it("list() returns all known processes including exited ones", async () => {
    const bus = new InMemoryEventBus();
    const manager = new ProcessManager(bus);

    const started = manager.start({
      name: "short-lived",
      command: NODE,
      args: ["-e", "process.exit(0);"],
      cwd: process.cwd()
    });

    await waitForExit(manager, started.id);

    const list = manager.list();
    expect(list.length).toBe(1);
    expect(list[0]!.name).toBe("short-lived");
    expect(list[0]!.endedAt).toBeDefined();
    expect(list[0]!.exitCode).toBe(0);

    // running() should NOT include the exited process.
    expect(manager.running()).toHaveLength(0);
  });

  it("recentLines() returns captured stdout/stderr lines", async () => {
    const bus = new InMemoryEventBus();
    const manager = new ProcessManager(bus);

    const started = manager.start({
      name: "lines-test",
      command: NODE,
      args: [
        "-e",
        "for (let i = 0; i < 3; i++) process.stdout.write(`line ${i}\\n`); process.exit(0);"
      ],
      cwd: process.cwd()
    });

    await waitForExit(manager, started.id);

    const lines = manager.recentLines(started.id);
    expect(lines).toEqual(expect.arrayContaining(["line 0", "line 1", "line 2"]));
  });

  it("stopAll() stops every running process", async () => {
    const bus = new InMemoryEventBus();
    const manager = new ProcessManager(bus);

    const a = manager.start({
      name: "a",
      command: NODE,
      args: ["-e", "setInterval(() => {}, 1000);"],
      cwd: process.cwd()
    });
    const b = manager.start({
      name: "b",
      command: NODE,
      args: ["-e", "setInterval(() => {}, 1000);"],
      cwd: process.cwd()
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(manager.running().length).toBe(2);

    manager.stopAll();

    await waitForExit(manager, a.id);
    await waitForExit(manager, b.id);

    expect(manager.running()).toHaveLength(0);
  });
});

/** Wait for a process to exit by polling the ProcessInfo. */
async function waitForExit(manager: ProcessManager, id: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = manager.get(id);
    if (info?.endedAt) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`Process ${id} did not exit within ${timeoutMs}ms`);
}
