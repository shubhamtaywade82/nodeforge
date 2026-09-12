import type { ChatMessage, ChatTurnResult, ToolInvocationRecord } from "@nodeforge/contracts";
import type { NodeForgeContext } from "./NodeForgeContext.js";
import { executeTool } from "./toolRunner.js";
import { isWriteTool } from "./toolPolicy.js";
import { NODEFORGE_SYSTEM_PROMPT } from "./systemPrompt.js";
import type { LlmClient, LlmMessage, LlmToolDefinition } from "./llm/types.js";
import { listToolDefinitions } from "./tools.js";

export class ChatCancelledError extends Error {
  override readonly name = "ChatCancelledError";
  constructor() {
    super("Chat cancelled");
  }
}

export interface AgentLoopOptions {
  maxToolRounds: number;
  workspaceTrusted: boolean;
  workspaceContextJson?: string;
  signal?: AbortSignal;
  onTextDelta?: (text: string) => void;
  onToolStart?: (name: string) => void;
  onToolEnd?: (record: ToolInvocationRecord) => void;
}

export class AgentLoop {
  constructor(
    private readonly llm: LlmClient,
    private readonly context: NodeForgeContext,
    private readonly model: string
  ) {}

  async runTurn(userText: string, history: ChatMessage[], options: AgentLoopOptions): Promise<ChatTurnResult> {
    this.throwIfCancelled(options.signal);
    const messages = this.buildMessages(userText, history, options.workspaceContextJson);
    const tools = toLlmTools();
    const invocations: ToolInvocationRecord[] = [];

    for (let round = 0; round < options.maxToolRounds; round++) {
      this.throwIfCancelled(options.signal);

      const result = await this.llm.complete({
        messages,
        tools,
        model: this.model,
        signal: options.signal,
        onTextDelta: options.onTextDelta
      });

      if (result.toolCalls.length === 0) {
        return {
          assistantMessage: result.content,
          toolInvocations: invocations,
          cancelled: false
        };
      }

      messages.push({
        role: "assistant",
        content: result.content || null,
        tool_calls: result.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
        }))
      });

      for (const call of result.toolCalls) {
        this.throwIfCancelled(options.signal);
        options.onToolStart?.(call.name);

        const started = Date.now();
        let output: string;
        let ok = true;

        if (isWriteTool(call.name) && !options.workspaceTrusted) {
          output = JSON.stringify({
            error: "Workspace is not trusted. Write tools are blocked in Restricted Mode."
          });
          ok = false;
        } else {
          try {
            output = await executeTool(call.name, call.arguments, this.context);
          } catch (err) {
            ok = false;
            output = JSON.stringify({
              error: err instanceof Error ? err.message : String(err)
            });
          }
        }

        const record: ToolInvocationRecord = {
          name: call.name,
          arguments: call.arguments,
          result: truncate(output, 12_000),
          ok,
          durationMs: Date.now() - started
        };
        invocations.push(record);
        options.onToolEnd?.(record);

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: record.result
        });
      }
    }

    return {
      assistantMessage: "Reached the maximum number of tool rounds. Try a narrower question.",
      toolInvocations: invocations,
      cancelled: false
    };
  }

  private buildMessages(userText: string, history: ChatMessage[], workspaceJson?: string): LlmMessage[] {
    const systemParts = [NODEFORGE_SYSTEM_PROMPT];
    if (workspaceJson) {
      systemParts.push(`Current workspace snapshot (JSON):\n${workspaceJson}`);
    }

    const messages: LlmMessage[] = [{ role: "system", content: systemParts.join("\n\n") }];

    for (const msg of history) {
      if (msg.role === "user" || msg.role === "assistant") {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: "user", content: userText });
    return messages;
  }

  private throwIfCancelled(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new ChatCancelledError();
    }
  }
}

function toLlmTools(): LlmToolDefinition[] {
  return listToolDefinitions().map((def) => ({
    type: "function",
    function: {
      name: def.name,
      description: def.description,
      parameters: def.inputSchema
    }
  }));
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…(truncated)`;
}
