/**
 * NodeForge error hierarchy.
 *
 * Every thrown error in NodeForge SHOULD be a `NodeForgeError` subclass so that
 * adapters, the runner, and the UI can pattern-match on `code` instead of
 * inspecting message strings.
 */

export type NodeForgeErrorCode =
  | "DETECTION_FAILED"
  | "PROCESS_SPAWN_FAILED"
  | "PROCESS_TIMEOUT"
  | "PROCESS_CANCELLED"
  | "PROCESS_NON_ZERO_EXIT"
  | "ADAPTER_NOT_AVAILABLE"
  | "ADAPTER_PARSE_FAILED"
  | "WORKSPACE_NOT_TRUSTED"
  | "INVALID_CONFIG"
  | "FILE_NOT_FOUND"
  | "UNKNOWN";

export class NodeForgeError extends Error {
  readonly code: NodeForgeErrorCode;
  override readonly cause?: unknown;

  constructor(code: NodeForgeErrorCode, message: string, opts?: { cause?: unknown }) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    if (opts && typeof opts === "object" && "cause" in opts) {
      this.cause = opts.cause;
    }
    // Restore prototype chain after extending built-in Error
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DetectionError extends NodeForgeError {
  constructor(message: string, opts?: { cause?: unknown }) {
    super("DETECTION_FAILED", message, opts);
  }
}

export class ProcessSpawnError extends NodeForgeError {
  constructor(message: string, opts?: { cause?: unknown }) {
    super("PROCESS_SPAWN_FAILED", message, opts);
  }
}

export class ProcessTimeoutError extends NodeForgeError {
  readonly command: string;
  readonly timeoutMs: number;

  constructor(command: string, timeoutMs: number, opts?: { cause?: unknown }) {
    super("PROCESS_TIMEOUT", `Process timed out after ${timeoutMs}ms: ${command}`, opts);
    this.command = command;
    this.timeoutMs = timeoutMs;
  }
}

export class ProcessCancelledError extends NodeForgeError {
  readonly command: string;

  constructor(command: string, opts?: { cause?: unknown }) {
    super("PROCESS_CANCELLED", `Process cancelled: ${command}`, opts);
    this.command = command;
  }
}

export class NonZeroExitError extends NodeForgeError {
  readonly exitCode: number;
  readonly command: string;
  readonly stdout: string;
  readonly stderr: string;

  constructor(
    command: string,
    exitCode: number,
    stdout: string,
    stderr: string,
    opts?: { cause?: unknown }
  ) {
    super(
      "PROCESS_NON_ZERO_EXIT",
      `Process exited with code ${exitCode}: ${command}`,
      opts
    );
    this.command = command;
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

export class AdapterNotAvailableError extends NodeForgeError {
  readonly adapterName: string;

  constructor(adapterName: string, opts?: { cause?: unknown }) {
    super("ADAPTER_NOT_AVAILABLE", `Adapter not available: ${adapterName}`, opts);
    this.adapterName = adapterName;
  }
}

export class AdapterParseError extends NodeForgeError {
  readonly adapterName: string;

  constructor(adapterName: string, message: string, opts?: { cause?: unknown }) {
    super("ADAPTER_PARSE_FAILED", `[${adapterName}] ${message}`, opts);
    this.adapterName = adapterName;
  }
}

export class WorkspaceNotTrustedError extends NodeForgeError {
  constructor(message = "Operation requires Workspace Trust") {
    super("WORKSPACE_NOT_TRUSTED", message);
  }
}

export class FileNotFoundError extends NodeForgeError {
  readonly path: string;

  constructor(path: string, opts?: { cause?: unknown }) {
    super("FILE_NOT_FOUND", `File not found: ${path}`, opts);
    this.path = path;
  }
}
