/**
 * NodeForge ProcessRunner.
 *
 * The single entry point for spawning child processes across NodeForge.
 * Every adapter goes through this — never `child_process.spawn` directly.
 *
 * Capabilities:
 *   - Cancellation via AbortSignal (SIGTERM, then SIGKILL after grace period)
 *   - Hard timeout (same cancellation sequence)
 *   - Bounded stdout/stderr buffers (default 1 MiB)
 *   - Explicit cwd + env merge (no implicit inheritance)
 *   - Cross-platform signal handling
 *   - Captured exit code, duration, pid
 *
 * Returns a `CommandResult` for successful runs and throws `NodeForgeError`
 * subclasses for cancellation, timeout, spawn failure, and non-zero exit
 * (when `throwOnNonZero` is true).
 */

import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import * as path from "node:path";
import {
  NonZeroExitError,
  ProcessCancelledError,
  ProcessSpawnError,
  ProcessTimeoutError,
  type CommandRequest,
  type CommandResult
} from "@nodeforge/contracts";

const DEFAULT_MAX_BUFFER_CHARS = 1024 * 1024; // 1 MiB
const DEFAULT_KILL_GRACE_MS = 2000;

export interface RunOptions {
  /** Throw `NonZeroExitError` on non-zero exit codes. Defaults to `false`. */
  throwOnNonZero?: boolean;
  /** Callback for each line of stdout as it arrives (streaming use case). */
  onStdoutLine?: (line: string) => void;
  /** Callback for each line of stderr as it arrives. */
  onStderrLine?: (line: string) => void;
}

export class ProcessRunner {
  /**
   * Run a command. Resolves with a `CommandResult` once the process exits.
   * Rejects with `NodeForgeError` subclasses for spawn failures, timeouts,
   * cancellation, and (optionally) non-zero exits.
   */
  async run(request: CommandRequest, opts: RunOptions = {}): Promise<CommandResult> {
    const { throwOnNonZero = false, onStdoutLine, onStderrLine } = opts;

    const maxBufferChars = request.maxBufferChars ?? DEFAULT_MAX_BUFFER_CHARS;
    const killGraceMs = request.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    const env = { ...process.env, ...(request.env ?? {}) };

    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (err) {
      throw new ProcessSpawnError(
        `Failed to spawn "${request.command} ${request.args.join(" ")}"`,
        { cause: err }
      );
    }

    if (typeof child.pid !== "number") {
      throw new ProcessSpawnError(`Spawned "${request.command}" but no pid was assigned`);
    }
    const pid = child.pid;
    const startedAt = Date.now();

    const stdoutBuf = new BoundedBuffer(maxBufferChars);
    const stderrBuf = new BoundedBuffer(maxBufferChars);
    let truncatedOut = false;
    let truncatedErr = false;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      const { truncated } = stdoutBuf.append(chunk);
      if (truncated) truncatedOut = true;
      for (const line of splitLines(chunk)) {
        onStdoutLine?.(line);
      }
    });
    child.stderr.on("data", (chunk: string) => {
      const { truncated } = stderrBuf.append(chunk);
      if (truncated) truncatedErr = true;
      for (const line of splitLines(chunk)) {
        onStderrLine?.(line);
      }
    });

    let timeoutHandle: NodeJS.Timeout | undefined;
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    const cleanup = (): void => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = undefined;
      }
    };

    const killWith = (signal: NodeJS.Signals): void => {
      try {
        child.kill(signal);
      } catch {
        // Process may have already exited — ignore.
      }
    };

    const gracefulKill = (): void => {
      killWith("SIGTERM");
      setTimeout(() => {
        if (!settled) killWith("SIGKILL");
      }, killGraceMs).unref();
    };

    // External cancellation via AbortSignal.
    const onAbort = (): void => {
      if (settled) return;
      cancelled = true;
      gracefulKill();
    };
    if (request.signal) {
      if (request.signal.aborted) {
        cancelled = true;
        gracefulKill();
      } else {
        request.signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    // Hard timeout.
    if (request.timeoutMs && request.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        gracefulKill();
      }, request.timeoutMs);
      timeoutHandle.unref?.();
    }

    return new Promise<CommandResult>((resolve, reject) => {
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (request.signal) request.signal.removeEventListener("abort", onAbort);
        reject(new ProcessSpawnError(`Process "${request.command}" emitted error`, { cause: err }));
      });

      child.on("close", (code, signal) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (request.signal) request.signal.removeEventListener("abort", onAbort);

        const exitCode = code === null ? null : code;
        const durationMs = Date.now() - startedAt;
        const stdout = stdoutBuf.toString() + (truncatedOut ? TRUNCATION_NOTICE : "");
        const stderr = stderrBuf.toString() + (truncatedErr ? TRUNCATION_NOTICE : "");

        const result: CommandResult = {
          request,
          exitCode,
          cancelled,
          timedOut,
          durationMs,
          stdout,
          stderr,
          pid
        };

        if (timedOut) {
          reject(new ProcessTimeoutError(request.command, request.timeoutMs ?? 0));
          return;
        }
        if (cancelled) {
          reject(new ProcessCancelledError(request.command));
          return;
        }
        // If killed by a signal but not from our cancellation/timeout, treat as failure.
        if (signal && exitCode === null) {
          reject(new ProcessSpawnError(`Process "${request.command}" killed by signal ${signal}`));
          return;
        }
        if (throwOnNonZero && exitCode !== null && exitCode !== 0) {
          reject(new NonZeroExitError(request.command, exitCode, stdout, stderr));
          return;
        }
        resolve(result);
      });
    });
  }
}

const TRUNCATION_NOTICE = "\n...[nodeforge: output truncated]\n";

/**
 * Bounded buffer for streaming stdout/stderr. Appends chunks until the
 * configured capacity is reached, then drops subsequent bytes.
 */
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

/**
 * Split a chunk into lines, dropping a trailing empty line if the chunk ends
 * with `\n`. Designed for the onStdoutLine/onStderrLine streaming callbacks.
 */
function splitLines(chunk: string): string[] {
  const lines = chunk.split(/\r?\n/);
  // Drop the final element if it's an empty string (chunk ended on newline).
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Resolve an executable path against PATH. Useful for adapters that need
 * to detect whether a tool (eslint, biome, tsc, etc.) is installed
 * before invoking it.
 */
export async function resolveExecutable(name: string): Promise<string | undefined> {
  // Use `process.env.PATH` instead of import("which") to keep deps minimal.
  const pathEnv = process.env.PATH ?? "";
  const sep = process.platform === "win32" ? ";" : ":";
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".exe").split(";") : [""];
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, `${name}${ext}`);
      try {
        // lstat is enough — we only need to know the file exists.
        const fs = await import("node:fs/promises");
        await fs.access(candidate);
        return candidate;
      } catch {
        // continue
      }
    }
  }
  return undefined;
}
