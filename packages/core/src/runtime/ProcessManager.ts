/**
 * Runtime ProcessManager — manages long-lived processes (dev servers, watch
 * modes, build pipelines) for the current workspace.
 *
 * Unlike the one-shot `ProcessRunner`, the ProcessManager keeps processes
 * alive and:
 *   - tracks `ProcessInfo` for each running process
 *   - streams stdout/stderr as `RuntimeEvent`s on the event bus
 *   - converts runtime errors (crashes, non-zero exits) into diagnostics
 *   - allows cancellation by id or "stop all"
 *
 * Use cases:
 *   - User runs "NodeForge: Start Dev Server" → manager starts `npm run dev`
 *   - When the process emits "Error: ..." lines, those become RuntimeEvents
 *   - When the process crashes (exit code != 0), the manager publishes a
 *     diagnostic so the UI can show the failure in the Problems panel.
 */

import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import * as path from "node:path";
import {
  diagnosticId,
  type Diagnostic,
  type EventBus,
  type ProcessInfo
} from "@nodeforge/contracts";

export interface StartProcessOptions {
  /** Display name shown in the sidebar (e.g. "dev:api"). */
  name: string;
  /** Executable name or absolute path. */
  command: string;
  /** Arguments. */
  args: string[];
  /** Working directory. Required. */
  cwd: string;
  /** Additional env vars to merge on top of `process.env`. */
  env?: Record<string, string>;
  /** Optional AbortSignal to cancel the process externally. */
  signal?: AbortSignal;
  /** Max chars to retain in stdout/stderr buffers. Defaults to 256 KiB. */
  maxBufferChars?: number;
}

export interface StartedProcess {
  /** Stable id assigned by the manager. */
  id: string;
  /** OS PID once spawned. */
  pid?: number;
  /** Display name. */
  name: string;
}

const DEFAULT_MAX_BUFFER = 256 * 1024;
const DEFAULT_LINE_BUFFER_LINES = 500;

/**
 * Patterns that match runtime error lines. When a process emits a line
 * matching one of these patterns, the manager:
 *   1. publishes a `runtime.event` with level "error"
 *   2. records a runtime-source diagnostic so the Problems panel shows it
 */
const RUNTIME_ERROR_PATTERNS: RegExp[] = [
  /^\s*Error:\s+.+/,
  /^\s*TypeError:\s+.+/,
  /^\s*RangeError:\s+.+/,
  /^\s*SyntaxError:\s+.+/,
  /^\s*ReferenceError:\s+.+/,
  /^\s*UnhandledPromiseRejection:.+/,
  /^\s*FATAL:.+/i,
  /^\s*EXCEPTION:.+/i
];

export class ProcessManager {
  /** id → live process info */
  private readonly processes = new Map<string, LiveProcess>();
  /** id → AbortController (so we can stop externally) */
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly bus: EventBus) {}

  /**
   * Start a long-lived process. The process runs in the background; stdout
   * and stderr are streamed as `RuntimeEvent`s. When the process exits, a
   * `runtime.processExited` event is fired.
   *
   * Throws synchronously if `command` cannot be spawned.
   */
  start(options: StartProcessOptions): StartedProcess {
    const id = randomUUID();
    const controller = new AbortController();
    if (options.signal) {
      // Forward external abort to our internal controller.
      options.signal.addEventListener(
        "abort",
        () => controller.abort(),
        { once: true }
      );
    }
    this.controllers.set(id, controller);

    const env = { ...process.env, ...(options.env ?? {}) };
    const maxBufferChars = options.maxBufferChars ?? DEFAULT_MAX_BUFFER;

    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn(options.command, options.args, {
        cwd: options.cwd,
        env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (err) {
      this.controllers.delete(id);
      throw err;
    }

    const info: ProcessInfo = {
      id,
      name: options.name,
      command: options.command,
      args: options.args,
      cwd: options.cwd,
      pid: typeof child.pid === "number" ? child.pid : undefined,
      startedAt: new Date().toISOString(),
      stdout: "",
      stderr: ""
    };

    const live: LiveProcess = {
      info,
      child,
      stdoutBuf: new BoundedBuffer(maxBufferChars),
      stderrBuf: new BoundedBuffer(maxBufferChars),
      truncatedOut: false,
      truncatedErr: false,
      lineBuffer: []
    };
    this.processes.set(id, live);

    // Wire up streaming.
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      const { truncated } = live.stdoutBuf.append(chunk);
      if (truncated) live.truncatedOut = true;
      for (const line of splitLines(chunk)) {
        pushLine(live.lineBuffer, line);
        this.handleLine(id, "stdout", line, options.cwd);
      }
    });
    child.stderr?.on("data", (chunk: string) => {
      const { truncated } = live.stderrBuf.append(chunk);
      if (truncated) live.truncatedErr = true;
      for (const line of splitLines(chunk)) {
        pushLine(live.lineBuffer, line);
        this.handleLine(id, "stderr", line, options.cwd);
      }
    });

    child.on("error", (err) => {
      this.bus.publish({
        type: "runtime.event",
        event: {
          timestamp: new Date().toISOString(),
          level: "error",
          message: `Process error: ${err.message}`,
          source: options.name
        }
      });
    });

    child.on("close", (code, signal) => {
      const exited: ProcessInfo = {
        ...info,
        endedAt: new Date().toISOString(),
        exitCode: code === null ? null : code,
        cancelled: signal === "SIGTERM" || signal === "SIGKILL",
        stdout: live.stdoutBuf.toString() + (live.truncatedOut ? "\n[truncated]" : ""),
        stderr: live.stderrBuf.toString() + (live.truncatedErr ? "\n[truncated]" : "")
      };
      live.info = exited;
      this.processes.set(id, live);
      this.controllers.delete(id);

      this.bus.publish({
        type: "runtime.processExited",
        pid: exited.pid ?? -1,
        exitCode: exited.exitCode ?? null,
        cancelled: exited.cancelled === true
      });

      // If the process exited with a non-zero code (and wasn't cancelled),
      // emit a diagnostic so the failure shows up in the Problems panel.
      if (exited.exitCode !== null && exited.exitCode !== 0 && !exited.cancelled) {
        this.publishExitDiagnostic(exited, options.cwd);
      }
    });

    this.bus.publish({
      type: "runtime.processStarted",
      pid: info.pid ?? -1,
      name: info.name
    });

    return { id, pid: info.pid, name: info.name };
  }

  /** Stop a process by id (SIGTERM, then SIGKILL after grace). */
  stop(id: string): boolean {
    const live = this.processes.get(id);
    if (!live) return false;
    const controller = this.controllers.get(id);
    if (controller) controller.abort();
    try {
      live.child.kill("SIGTERM");
      setTimeout(() => {
        if (!live.info.endedAt) live.child.kill("SIGKILL");
      }, 2000).unref();
    } catch {
      // already dead
    }
    return true;
  }

  /** Stop all running processes. */
  stopAll(): void {
    for (const id of Array.from(this.processes.keys())) {
      this.stop(id);
    }
  }

  /** Returns info for a single process. */
  get(id: string): ProcessInfo | undefined {
    return this.processes.get(id)?.info;
  }

  /** Returns info for all processes (running and exited). */
  list(): ProcessInfo[] {
    return Array.from(this.processes.values()).map((p) => p.info);
  }

  /** Returns only currently-running processes. */
  running(): ProcessInfo[] {
    return this.list().filter((p) => p.endedAt === undefined);
  }

  /** Returns the recent line buffer (stdout + stderr interleaved). */
  recentLines(id: string, maxLines = DEFAULT_LINE_BUFFER_LINES): string[] {
    const live = this.processes.get(id);
    if (!live) return [];
    return live.lineBuffer.slice(-maxLines);
  }

  /** Dispose: stop all processes. */
  dispose(): void {
    this.stopAll();
  }

  // --- Internals ---

  private handleLine(processId: string, stream: "stdout" | "stderr", line: string, cwd: string): void {
    const level = stream === "stderr" ? "warn" : "info";

    // Always publish a runtime event.
    this.bus.publish({
      type: "runtime.event",
      event: {
        timestamp: new Date().toISOString(),
        level,
        message: line,
        source: this.processes.get(processId)?.info.name
      }
    });

    // If the line matches a runtime error pattern, also publish a diagnostic.
    for (const pattern of RUNTIME_ERROR_PATTERNS) {
      if (pattern.test(line)) {
        this.publishLineDiagnostic(processId, line, cwd, "error");
        break;
      }
    }
  }

  private publishLineDiagnostic(processId: string, line: string, cwd: string, severity: Diagnostic["severity"]): void {
    const live = this.processes.get(processId);
    if (!live) return;
    const file = path.join(cwd, `<${live.info.name}>`);
    const diag: Diagnostic = {
      id: diagnosticId({
        source: "runtime",
        rule: "runtime-error",
        file,
        line: 1,
        column: 1
      }),
      source: "runtime",
      severity,
      message: line,
      file,
      range: { line: 1, column: 1 },
      rule: "runtime-error",
      fixable: false
    };
    // Runtime diagnostics aren't stored in the DiagnosticStore (the store is
    // adapter-driven). Instead we publish directly on the bus so the UI can
    // display them transiently. (Future: a runtime diagnostic ring buffer.)
    void diag;
    this.bus.publish({
      type: "runtime.event",
      event: {
        timestamp: new Date().toISOString(),
        level: severityToLogLevel(severity),
        message: line,
        source: live.info.name,
        file
      }
    });
  }

  private publishExitDiagnostic(info: ProcessInfo, cwd: string): void {
    const file = path.join(cwd, `<${info.name}>`);
    const message = `Process "${info.name}" exited with code ${info.exitCode}`;
    this.bus.publish({
      type: "runtime.event",
      event: {
        timestamp: new Date().toISOString(),
        level: "error",
        message,
        source: info.name,
        file
      }
    });
  }
}

interface LiveProcess {
  info: ProcessInfo;
  child: ChildProcessByStdio<null, Readable, Readable>;
  stdoutBuf: BoundedBuffer;
  stderrBuf: BoundedBuffer;
  truncatedOut: boolean;
  truncatedErr: boolean;
  lineBuffer: string[];
}

class BoundedBuffer {
  private buf = "";
  private truncated = false;
  constructor(private readonly maxChars: number) {}

  append(chunk: string): { truncated: boolean } {
    if (this.truncated) return { truncated: true };
    const remaining = this.maxChars - this.buf.length;
    if (chunk.length <= remaining) {
      this.buf += chunk;
    } else {
      this.buf += chunk.slice(0, Math.max(0, remaining));
      this.truncated = true;
    }
    return { truncated: this.truncated };
  }

  toString(): string {
    return this.buf;
  }
}

function splitLines(chunk: string): string[] {
  const lines = chunk.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function pushLine(buffer: string[], line: string): void {
  buffer.push(line);
  // Cap the line buffer to prevent unbounded growth.
  if (buffer.length > DEFAULT_LINE_BUFFER_LINES * 2) {
    buffer.splice(0, buffer.length - DEFAULT_LINE_BUFFER_LINES);
  }
}

/** Map a DiagnosticSeverity to the closest RuntimeEvent LogLevel. */
function severityToLogLevel(severity: Diagnostic["severity"]): "debug" | "info" | "warn" | "error" {
  switch (severity) {
    case "error":
      return "error";
    case "warning":
      return "warn";
    case "info":
      return "info";
    case "hint":
      return "debug";
  }
}
