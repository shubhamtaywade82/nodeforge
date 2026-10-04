import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { buildTestDebugConfiguration } from "../src/core/testDebugConfiguration.ts";

const ROOT = "/workspace/app";

describe("buildTestDebugConfiguration", () => {
  it("builds a whole-workspace debug configuration when no file is selected", () => {
    const config = buildTestDebugConfiguration({
      runner: "node",
      workspaceRoot: ROOT
    });

    assert.equal(config.runtimeExecutable, "node");
    assert.deepEqual(config.runtimeArgs, ["--inspect-brk", "--test"]);
    assert.equal(config.name, "Debug node:test: workspace");
  });

  it("builds a native node:test debug configuration", () => {
    const config = buildTestDebugConfiguration({
      runner: "node",
      workspaceRoot: ROOT,
      file: join(ROOT, "test/math.test.js"),
      fullName: "math > adds numbers"
    });

    assert.equal(config.runtimeExecutable, "node");
    assert.deepEqual(config.runtimeArgs, [
      "--inspect-brk",
      "--test",
      join(ROOT, "test/math.test.js"),
      "--test-name-pattern",
      "^math > adds numbers$"
    ]);
    assert.equal(config.cwd, ROOT);
    assert.equal(config.autoAttachChildProcesses, true);
  });

  it("builds a local Vitest debug configuration", () => {
    const file = join(ROOT, "test/math.test.ts");
    const config = buildTestDebugConfiguration({
      runner: "vitest",
      workspaceRoot: ROOT,
      file,
      fullName: "math > adds numbers"
    });

    assert.equal(config.runtimeExecutable, "node");
    assert.deepEqual(config.runtimeArgs, [
      "--inspect-brk",
      join(ROOT, "node_modules/vitest/vitest.mjs"),
      "run",
      file,
      "-t",
      "math > adds numbers"
    ]);
    assert.equal(config.autoAttachChildProcesses, true);
  });

  it("builds a local Jest debug configuration", () => {
    const file = join(ROOT, "test/math.test.ts");
    const config = buildTestDebugConfiguration({
      runner: "jest",
      workspaceRoot: ROOT,
      file
    });

    assert.equal(config.runtimeExecutable, "node");
    assert.deepEqual(config.runtimeArgs, [
      "--inspect-brk",
      join(ROOT, "node_modules/jest/bin/jest.js"),
      file,
      "--runInBand"
    ]);
  });
});
