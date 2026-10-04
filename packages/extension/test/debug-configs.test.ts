import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCurrentTsFileConfig, hasDependency } from "../src/core/debugConfigs.ts";
import { runnerEntryPath } from "../src/core/testDebugConfiguration.ts";

describe("buildCurrentTsFileConfig", () => {
  it("uses the project's own tsx when declared", () => {
    const cfg = buildCurrentTsFileConfig({ devDependencies: { tsx: "^4.0.0" } });
    assert.equal(cfg.runtimeExecutable, "node");
    assert.deepEqual(cfg.runtimeArgs, ["--import", "tsx"]);
    assert.equal(cfg.program, "${file}");
  });

  it("falls back to Node type stripping when tsx is not declared", () => {
    const cfg = buildCurrentTsFileConfig({ dependencies: {} });
    assert.deepEqual(cfg.runtimeArgs, ["--experimental-strip-types"]);
  });

  it("never launches through npx, pnpm dlx or a package-manager shim", () => {
    for (const pkg of [undefined, {}, { devDependencies: { tsx: "1" } }]) {
      const cfg = buildCurrentTsFileConfig(pkg);
      assert.equal(cfg.runtimeExecutable, "node");
      assert.ok(!JSON.stringify(cfg).match(/npx|dlx|npm exec|pnpm exec/));
    }
  });
});

describe("hasDependency", () => {
  it("checks dependencies and devDependencies", () => {
    assert.equal(hasDependency({ dependencies: { a: "1" } }, "a"), true);
    assert.equal(hasDependency({ devDependencies: { b: "1" } }, "b"), true);
    assert.equal(hasDependency({}, "c"), false);
    assert.equal(hasDependency(undefined, "c"), false);
  });
});

describe("runnerEntryPath", () => {
  it("points at the locally installed runner entry points", () => {
    assert.match(runnerEntryPath("vitest", "/w"), /node_modules[\\/]vitest[\\/]vitest\.mjs$/);
    assert.match(runnerEntryPath("jest", "/w"), /node_modules[\\/]jest[\\/]bin[\\/]jest\.js$/);
  });
});
