import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { terminalProfileOptions } from "../src/core/terminalProfile.ts";

describe("terminalProfileOptions", () => {
  it("pins cwd and exposes the workspace root to tooling", () => {
    assert.deepEqual(terminalProfileOptions("/w"), {
      name: "NodeForge",
      cwd: "/w",
      env: { NODEFORGE_WORKSPACE_ROOT: "/w" }
    });
  });

  it("rejects an empty root", () => {
    assert.throws(() => terminalProfileOptions(""), /workspace root/);
  });
});
