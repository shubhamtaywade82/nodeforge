import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyScript, scriptInvocation } from "../src/core/taskMeta.ts";

describe("classifyScript", () => {
  it("maps tsc to the tsc matcher and the build group", () => {
    const meta = classifyScript("build", "tsc -b --pretty false");
    assert.deepEqual(meta.problemMatchers, ["$tsc"]);
    assert.equal(meta.group, "build");
    assert.equal(meta.isBackground, false);
  });

  it("uses the watch matcher and background mode for tsc --watch", () => {
    const meta = classifyScript("dev:types", "tsc --noEmit --watch");
    assert.deepEqual(meta.problemMatchers, ["$tsc-watch"]);
    assert.equal(meta.isBackground, true);
  });

  it("maps eslint to eslint-stylish", () => {
    assert.deepEqual(classifyScript("lint", "eslint . --max-warnings 0").problemMatchers, ["$eslint-stylish"]);
  });

  it("does not match tools that merely contain 'tsc' or 'eslint' in a word", () => {
    assert.deepEqual(classifyScript("x", "node scripts/mytsc.js").problemMatchers, []);
    assert.deepEqual(classifyScript("x", "prettier --check eslint-config").problemMatchers, []);
  });

  it("flags dev/start/serve/watch scripts as background", () => {
    for (const name of ["dev", "start", "serve", "watch", "dev:api"]) {
      assert.equal(classifyScript(name, "node server.js").isBackground, true, name);
    }
    assert.equal(classifyScript("restart-db", "node x.js").isBackground, false);
  });

  it("groups test and clean scripts", () => {
    assert.equal(classifyScript("test", "vitest run").group, "test");
    assert.equal(classifyScript("test:unit", "vitest run").group, "test");
    assert.equal(classifyScript("clean", "rm -rf dist").group, "clean");
    assert.equal(classifyScript("deploy", "x").group, undefined);
  });
});

describe("scriptInvocation", () => {
  it("uses `run` for npm/pnpm and the bare script for yarn", () => {
    assert.deepEqual(scriptInvocation("npm", "build"), { command: "npm", args: ["run", "build"] });
    assert.deepEqual(scriptInvocation("pnpm", "build"), { command: "pnpm", args: ["run", "build"] });
    assert.deepEqual(scriptInvocation("yarn", "build"), { command: "yarn", args: ["build"] });
  });
});
