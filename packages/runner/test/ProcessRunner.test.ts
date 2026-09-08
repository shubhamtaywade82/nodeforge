/**
 * Tests for the ProcessRunner.
 *
 * Uses `node -e` to spawn tiny inline scripts so we can test:
 *   - normal exit 0
 *   - non-zero exit
 *   - stdout/stderr capture + line streaming
 *   - timeout cancellation
 *   - AbortSignal cancellation
 *   - bounded buffer truncation
 */

import { describe, expect, it } from "vitest";
import {
  NonZeroExitError,
  ProcessCancelledError,
  ProcessTimeoutError,
  type CommandRequest
} from "@nodeforge/contracts";
import { ProcessRunner } from "../src/ProcessRunner.js";

const runner = new ProcessRunner();

function nodeReq(args: string[], opts: Partial<CommandRequest> = {}): CommandRequest {
  return {
    command: process.execPath,
    args,
    cwd: process.cwd(),
    ...opts
  };
}

describe("ProcessRunner", () => {
  it("captures stdout and exit code 0", async () => {
    const result = await runner.run(
      nodeReq(["-e", "process.stdout.write('hello world\\n'); process.exit(0);"])
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello world");
    expect(result.cancelled).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(result.pid).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("captures stderr separately", async () => {
    const result = await runner.run(
      nodeReq(["-e", "process.stderr.write('oops\\n'); process.exit(0);"])
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("oops");
    expect(result.stdout).not.toContain("oops");
  });

  it("reports non-zero exit codes", async () => {
    const result = await runner.run(nodeReq(["-e", "process.exit(3);"]));
    expect(result.exitCode).toBe(3);
  });

  it("throws NonZeroExitError when throwOnNonZero is true", async () => {
    await expect(
      runner.run(nodeReq(["-e", "process.exit(7);"]), { throwOnNonZero: true })
    ).rejects.toBeInstanceOf(NonZeroExitError);
  });

  it("streams stdout lines via onStdoutLine", async () => {
    const lines: string[] = [];
    await runner.run(
      nodeReq(["-e", "for (const l of ['a','b','c']) process.stdout.write(l + '\\n');"]),
      { onStdoutLine: (l) => lines.push(l) }
    );
    expect(lines).toEqual(["a", "b", "c"]);
  });

  it("streams stderr lines via onStderrLine", async () => {
    const lines: string[] = [];
    await runner.run(
      nodeReq(["-e", "process.stderr.write('warn1\\nwarn2\\n');"]),
      { onStderrLine: (l) => lines.push(l) }
    );
    expect(lines).toEqual(["warn1", "warn2"]);
  });

  it("throws ProcessTimeoutError when timeoutMs is exceeded", async () => {
    // Sleep 5 seconds; timeout at 100ms.
    await expect(
      runner.run(
        nodeReq(["-e", "setTimeout(() => process.exit(0), 5000);"], { timeoutMs: 100 })
      )
    ).rejects.toBeInstanceOf(ProcessTimeoutError);
  });

  it("throws ProcessCancelledError when AbortSignal fires", async () => {
    const controller = new AbortController();
    const promise = runner.run(
      nodeReq(["-e", "setTimeout(() => process.exit(0), 5000);"], { signal: controller.signal })
    );
    // Give the child a moment to start, then abort.
    setTimeout(() => controller.abort(), 50);
    await expect(promise).rejects.toBeInstanceOf(ProcessCancelledError);
  });

  it("truncates stdout when maxBufferChars is exceeded", async () => {
    // Write 10 KiB; cap at 1 KiB.
    const result = await runner.run(
      nodeReq([
        "-e",
        "process.stdout.write('x'.repeat(10240)); process.exit(0);"
      ], { maxBufferChars: 1024 })
    );
    expect(result.stdout.length).toBeLessThanOrEqual(1100); // 1024 + truncation notice
    expect(result.stdout).toContain("truncated");
  });

  it("passes env vars to the child process", async () => {
    const result = await runner.run(
      nodeReq(["-e", "process.stdout.write(process.env.NODEFORGE_TEST_VAR || 'unset');"]),
      // Note: env is set on the request, not via RunOptions.
    );
    // Without env set, child should print 'unset'.
    expect(result.stdout).toBe("unset");

    const result2 = await runner.run({
      command: process.execPath,
      args: ["-e", "process.stdout.write(process.env.NODEFORGE_TEST_VAR || 'unset');"],
      cwd: process.cwd(),
      env: { NODEFORGE_TEST_VAR: "set-value" }
    });
    expect(result2.stdout).toBe("set-value");
  });

  it("uses the explicit cwd", async () => {
    const result = await runner.run({
      command: process.execPath,
      args: ["-e", "process.stdout.write(process.cwd());"],
      cwd: __dirname // vitest runs in this dir, use it as a known cwd
    });
    expect(result.stdout).toBe(__dirname);
  });
});
