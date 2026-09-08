/**
 * Test contracts.
 *
 * Each test adapter (Vitest, Jest, Node test) converts its runner output
 * into these shapes so the core testing module and VS Code Test Explorer
 * see a unified model.
 */

export type TestStatus = "passed" | "failed" | "skipped" | "todo" | "running" | "errored";

/** A single leaf test case. */
export interface TestCase {
  /** Stable id, e.g. `${suitePath}:${testName}`. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Absolute path to the test file. */
  file: string;
  /** Optional 1-based line where the test is declared. */
  line?: number;
  status: TestStatus;
  durationMs?: number;
  /** Failure / error message, if status is failed/errored. */
  error?: TestFailure;
}

/** A failure detail. */
export interface TestFailure {
  message: string;
  /** Optional expected value, for assertion-style failures. */
  expected?: unknown;
  /** Optional actual value. */
  actual?: unknown;
  /** Optional stack trace as a single string (raw from the runner). */
  stack?: string;
  /** Optional source location of the failure (may differ from the test declaration). */
  location?: { file: string; line: number; column?: number };
}

/** A suite groups other suites and/or test cases. */
export interface TestSuite {
  id: string;
  name: string;
  file?: string;
  suites: TestSuite[];
  tests: TestCase[];
}

/** Result of running a single test or suite. */
export interface TestRunResult {
  /** Id of the test or suite that was run. */
  id: string;
  status: TestStatus;
  durationMs: number;
  /** Number of tests in each status bucket. */
  counts: Record<TestStatus, number>;
  /** Failures, in order. */
  failures: TestFailure[];
  /** Stdout captured during this run (truncated to a bounded buffer). */
  stdout?: string;
  /** Stderr captured during this run (truncated). */
  stderr?: string;
}

/**
 * Adapter-side provider contract — every test adapter implements this.
 */
export interface TestProvider {
  readonly name: string;
  /** Discover the test tree for the given workspace root. */
  discover(workspaceRoot: string): Promise<TestSuite>;
  /** Run a single test or suite by id, or all tests if undefined. */
  run(workspaceRoot: string, testId?: string, signal?: AbortSignal): Promise<TestRunResult>;
}
