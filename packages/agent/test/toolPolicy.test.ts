import { describe, expect, it } from "vitest";
import { TOOLS } from "../src/tools.js";
import {
  TOOL_POLICIES,
  authorizeTool,
  getMcpExecutionContext,
  WRITE_TOOL_NAMES,
  type ToolExecutionContext
} from "../src/toolPolicy.js";
import { TOOLS } from "../src/tools.js";

describe("tool execution policy", () => {
  it("has an authorization policy for every registered tool", () => {
    const registered = new Set(TOOLS.map((tool) => tool.definition.name));
    expect(Object.keys(TOOL_POLICIES).sort()).toEqual([...registered].sort());
  });

  it("has a policy for every exposed tool", () => {
    for (const tool of TOOLS) {
      expect(TOOL_POLICIES[tool.definition.name]).toBeDefined();
    }
  });

  it("keeps mutating tools in the write-tool set", () => {
    expect(WRITE_TOOL_NAMES).toEqual(
      new Set(["runScript", "formatFiles", "applyEslintFix"])
    );
  });

  it("classifies code execution and workspace mutation separately", () => {
    expect(TOOL_POLICIES.runScript).toMatchObject({
      risk: "execute",
      mutatesWorkspace: true,
      executesCode: true,
      requiresApproval: true
    });
    expect(TOOL_POLICIES.formatFiles).toMatchObject({
      risk: "write",
      mutatesWorkspace: true,
      executesCode: false,
      requiresApproval: true
    });
    expect(TOOL_POLICIES.getProjectContext).toMatchObject({
      risk: "read",
      mutatesWorkspace: false,
      executesCode: false
    });
  });

  it("denies execution in the default MCP mode", () => {
    const context = getMcpExecutionContext({});
    const decision = authorizeTool("runTests", context);

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/execution is disabled/i);
  });

  it("requires explicit write approval for the agent caller", () => {
    const base: ToolExecutionContext = {
      caller: "agent",
      workspaceTrusted: true,
      executionAllowed: true,
      writesAllowed: true,
      networkAllowed: true,
      approvalGranted: false
    };

    expect(authorizeTool("formatFiles", base).allowed).toBe(false);
    expect(
      authorizeTool("formatFiles", { ...base, approvalGranted: true }).allowed
    ).toBe(true);
  });

  it("requires workspace trust even when MCP execution is enabled", () => {
    const context = getMcpExecutionContext({
      NODEFORGE_ALLOW_EXECUTION: "true",
      NODEFORGE_ALLOW_WRITES: "true",
      NODEFORGE_WORKSPACE_TRUSTED: "false"
    });

    const decision = authorizeTool("formatFiles", context);

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/trusted/i);
  });
});
