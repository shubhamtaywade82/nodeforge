/**
 * Command execution contracts.
 *
 * `CommandRequest` is what the ProcessRunner consumes. `CommandResult` is
 * what every adapter returns after invoking an external CLI. Adapters MUST
 * go through the runner — they never call `child_process.spawn` directly.
 */

export interface CommandRequest {
  /** Executable name or absolute path. */
  command: string;
  /** Arguments, exactly as passed to the process (no shell interpolation). */
  args: string[];
  /** Working directory. Required — never inherit cwd implicitly. */
  cwd: string;
  /** Additional env vars to merge on top of `process.env`. */
  env?: Record<string, string>;
  /** Hard timeout in ms. After this, the runner sends SIGTERM then SIGKILL. */
  timeoutMs?: number;
  /**
   * Grace period between SIGTERM and SIGKILL, in ms. Defaults to 2000.
   * Only relevant when an AbortSignal cancels the run.
   */
  killGraceMs?: number;
  /** Optional AbortSignal to cancel the run externally. */
  signal?: AbortSignal;
  /** Optional cap on stdout/stderr buffer size (chars). Defaults to 1 MiB. */
  maxBufferChars?: number;
}

export interface CommandResult {
  /** The request that produced this result. */
  request: CommandRequest;
  /** Process exit code. `null` if the process was killed. */
  exitCode: number | null;
  /** True if the process was cancelled via AbortSignal. */
  cancelled: boolean;
  /** True if the process exceeded its timeout. */
  timedOut: boolean;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** Bounded stdout. */
  stdout: string;
  /** Bounded stderr. */
  stderr: string;
  /** OS PID, if available. */
  pid?: number;
}
