import { describe, expect, it } from "vitest";
import {
  TOOL_POLICIES,
  authorizeTool,
  getMcpExecutionContext,
  type ToolExecutionContext
} from "../src/toolPolicy.js";

describe("tool execution policy", () => {
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
      approvalGranted: false
    };

    expect(authorizeTool("formatFiles", base).allowed).toBe(false);
    expect(authorizeTool("formatFiles", { ...base, approvalGranted: true }).allowed).toBe(true);
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
