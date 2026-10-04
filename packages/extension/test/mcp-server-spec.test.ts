import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMcpServerSpec } from "../src/ai/mcpServerSpec.ts";

const base = {
  extensionPath: "/ext/nodeforge",
  workspaceRoot: "/work/app",
  preferredNodeBinary: "",
  hostExecPath: "/usr/share/code/code",
  version: "0.1.0",
  pathSeparator: "/"
};

describe("buildMcpServerSpec", () => {
  it("runs the bundled server under the host runtime as Node", () => {
    const spec = buildMcpServerSpec(base);
    assert.equal(spec.command, "/usr/share/code/code");
    assert.deepEqual(spec.args, ["/ext/nodeforge/dist/mcp.cjs"]);
    assert.equal(spec.env["ELECTRON_RUN_AS_NODE"], "1");
    assert.equal(spec.env["NODEFORGE_WORKSPACE_ROOT"], "/work/app");
  });

  it("grants trust and execution but not writes or network by default", () => {
    const { env } = buildMcpServerSpec(base);
    assert.equal(env["NODEFORGE_WORKSPACE_TRUSTED"], "true");
    assert.equal(env["NODEFORGE_ALLOW_EXECUTION"], "true");
    assert.equal(env["NODEFORGE_ALLOW_WRITES"], "false");
    assert.equal(env["NODEFORGE_ALLOW_NETWORK"], "false");
  });

  it("applies explicit capability settings", () => {
    const { env } = buildMcpServerSpec({ ...base, allowExecution: false, allowWrites: true, allowNetwork: true });
    assert.equal(env["NODEFORGE_ALLOW_EXECUTION"], "false");
    assert.equal(env["NODEFORGE_ALLOW_WRITES"], "true");
    assert.equal(env["NODEFORGE_ALLOW_NETWORK"], "true");
  });

  it("uses a preferred Node binary without the Electron flag", () => {
    const spec = buildMcpServerSpec({ ...base, preferredNodeBinary: " /opt/node/bin/node " });
    assert.equal(spec.command, "/opt/node/bin/node");
    assert.equal("ELECTRON_RUN_AS_NODE" in spec.env, false);
  });

  it("rejects an empty workspace root", () => {
    assert.throws(() => buildMcpServerSpec({ ...base, workspaceRoot: "" }), /workspace root/);
  });
});
