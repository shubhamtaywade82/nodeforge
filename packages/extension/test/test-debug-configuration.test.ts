import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { buildTestDebugConfiguration } from "../src/core/testDebugConfiguration.ts";

const ROOT = "/workspace/app";

describe("buildTestDebugConfiguration", () => {
  it("builds a whole-workspace debug configuration when no file is selected", () => {
    const config = buildTestDebugConfiguration({
      runner: "node",
      workspaceRoot: ROOT
    });

    expect(config.runtimeExecutable).toBe("node");
    expect(config.runtimeArgs).toEqual(["--inspect-brk", "--test"]);
    expect(config.name).toBe("Debug node:test: workspace");
  });

  it("builds a native node:test debug configuration", () => {
    const config = buildTestDebugConfiguration({
      runner: "node",
      workspaceRoot: ROOT,
      file: join(ROOT, "test/math.test.js"),
      fullName: "math > adds numbers"
    });

    expect(config.runtimeExecutable).toBe("node");
    expect(config.runtimeArgs).toEqual([
      "--inspect-brk",
      "--test",
      join(ROOT, "test/math.test.js"),
      "--test-name-pattern",
      "^math > adds numbers$"
    ]);
    expect(config.cwd).toBe(ROOT);
    expect(config.autoAttachChildProcesses).toBe(true);
  });

  it("builds a local Vitest debug configuration", () => {
    const file = join(ROOT, "test/math.test.ts");
    const config = buildTestDebugConfiguration({
      runner: "vitest",
      workspaceRoot: ROOT,
      file,
      fullName: "math > adds numbers"
    });

    expect(config.runtimeExecutable).toBe("node");
    expect(config.runtimeArgs).toEqual([
      "--inspect-brk",
      join(ROOT, "node_modules/vitest/vitest.mjs"),
      "run",
      file,
      "-t",
      "math > adds numbers"
    ]);
    expect(config.autoAttachChildProcesses).toBe(true);
  });

  it("builds a local Jest debug configuration", () => {
    const file = join(ROOT, "test/math.test.ts");
    const config = buildTestDebugConfiguration({
      runner: "jest",
      workspaceRoot: ROOT,
      file
    });

    expect(config.runtimeExecutable).toBe("node");
    expect(config.runtimeArgs).toEqual([
      "--inspect-brk",
      join(ROOT, "node_modules/jest/bin/jest.js"),
      file,
      "--runInBand"
    ]);
  });
});
