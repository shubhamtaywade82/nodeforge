import { describe, expect, it, vi } from "vitest";
import * as path from "node:path";

import { AgentLoop } from "../src/AgentLoop.js";
import { NodeForgeContext } from "../src/NodeForgeContext.js";
import type { LlmClient, LlmCompletionRequest, LlmCompletionResult } from "../src/llm/types.js";

const FIXTURE = path.resolve(__dirname, "../../test-fixtures/node-ts-docker");

class MockLlm implements LlmClient {
  private readonly steps: LlmCompletionResult[];

  constructor(steps: LlmCompletionResult[]) {
    this.steps = steps;
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const step = this.steps.shift();
    if (!step) {
      return { content: "done", toolCalls: [] };
    }
    if (request.onTextDelta && step.content) {
      request.onTextDelta(step.content);
    }
    return step;
  }
}

describe("AgentLoop", () => {
  it("runs a tool and returns assistant text", async () => {
    const ctx = new NodeForgeContext(FIXTURE);
    const llm = new MockLlm([
      {
        content: "",
        toolCalls: [{ id: "call_1", name: "getProjectContext", arguments: {} }]
      },
      { content: "Your project uses ESLint.", toolCalls: [] }
    ]);

    const loop = new AgentLoop(llm, ctx, "test-model");
    const result = await loop.runTurn("What linter?", [], {
      maxToolRounds: 4,
      workspaceTrusted: true
    });

    expect(result.toolInvocations).toHaveLength(1);
    expect(result.toolInvocations[0]?.name).toBe("getProjectContext");
    expect(result.assistantMessage).toContain("ESLint");
  });

  it("blocks write tools when workspace is not trusted", async () => {
    const ctx = new NodeForgeContext(FIXTURE);
    const llm = new MockLlm([
      {
        content: "",
        toolCalls: [{ id: "call_1", name: "formatFiles", arguments: {} }]
      },
      { content: "Cannot format in restricted mode.", toolCalls: [] }
    ]);

    const loop = new AgentLoop(llm, ctx, "test-model");
    const result = await loop.runTurn("format", [], {
      maxToolRounds: 4,
      workspaceTrusted: false
    });

    expect(result.toolInvocations[0]?.ok).toBe(false);
    expect(result.toolInvocations[0]?.result).toContain("not trusted");
  });

  it("respects abort signal", async () => {
    const ctx = new NodeForgeContext(FIXTURE);
    const llm: LlmClient = {
      complete: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 50));
        return { content: "late", toolCalls: [] };
      })
    };
    const loop = new AgentLoop(llm, ctx, "test-model");
    const controller = new AbortController();
    controller.abort();

    await expect(
      loop.runTurn("hi", [], {
        maxToolRounds: 2,
        workspaceTrusted: true,
        signal: controller.signal
      })
    ).rejects.toThrow(/Chat cancelled/);
  });
});
