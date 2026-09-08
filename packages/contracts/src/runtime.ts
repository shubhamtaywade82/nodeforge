/**
 * Runtime contracts — process lifecycle and runtime log events.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/** A log line emitted by a running process, normalized for the UI and agent. */
export interface RuntimeEvent {
  /** ISO-8601 timestamp. */
  timestamp: string;
  level: LogLevel;
  message: string;
  /** Optional source (logger name, module). */
  source?: string;
  /** Optional source location. */
  file?: string;
  line?: number;
  /** Optional structured fields from a parsed JSON log line. */
  fields?: Record<string, unknown>;
}

/**
 * A managed runtime process — typically `npm run dev`, `tsx watch`, etc.
 * The runtime engine tracks these so failures can flow into the diagnostic store.
 */
export interface ProcessInfo {
  /** Stable id assigned by the runner. */
  id: string;
  /** Display name, e.g. `dev:api`. */
  name: string;
  /** The command string shown to the user. */
  command: string;
  args: string[];
  cwd: string;
  /** OS PID, available once spawned. */
  pid?: number;
  /** When the process was started (ISO-8601). */
  startedAt?: string;
  /** When the process exited (ISO-8601). */
  endedAt?: string;
  /** Exit code, if exited normally. */
  exitCode?: number | null;
  /** True if the process was cancelled via AbortSignal. */
  cancelled?: boolean;
  /** Bounded stdout buffer. */
  stdout?: string;
  /** Bounded stderr buffer. */
  stderr?: string;
}
