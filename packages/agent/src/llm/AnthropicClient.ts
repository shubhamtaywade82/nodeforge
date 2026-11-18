import type { LlmClient, LlmClientConfig, LlmCompletionRequest, LlmCompletionResult, LlmMessage } from "./types.js";

interface AnthropicContentBlock {
  type: "text" | "tool_use";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicStreamEvent {
  type?: string;
  index?: number;
  content_block?: { type?: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; partial_json?: string };
}

/** Resolves and validates the Anthropic Messages endpoint URL. */
export function resolveAnthropicUrl(rawBase: string): string {
  const clean = rawBase.trim().replace(/\/$/, "");
  if (!/^https:\/\//i.test(clean) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(clean)) {
    throw new Error(`Invalid Anthropic baseUrl "${rawBase}". HTTPS is required (or http://localhost for local proxies).`);
  }
  if (clean.endsWith("/v1/messages")) return clean;
  if (clean.endsWith("/v1")) return `${clean}/messages`;
  return `${clean}/v1/messages`;
}

export class AnthropicClient implements LlmClient {
  constructor(private readonly config: LlmClientConfig) {}

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const url = resolveAnthropicUrl(this.config.baseUrl);
    const { system, messages } = splitSystemAndMessages(request.messages);
    const body: Record<string, unknown> = {
      ...(request.modelOptions ?? {}),
      model: request.model || this.config.model,
      max_tokens: Number(request.modelOptions?.["max_tokens"] ?? 4096),
      ...(system ? { system } : {}),
      messages,
      stream: Boolean(request.onTextDelta)
    };

    if (request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters
      }));
      if (request.toolChoice === "required") {
        body.tool_choice = { type: "any" };
      } else if (request.toolChoice === "auto") {
        body.tool_choice = { type: "auto" };
      }
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body),
      signal: request.signal
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic request failed (${response.status}): ${text.slice(0, 500)}`);
    }

    if (!request.onTextDelta) {
      const json = (await response.json()) as { content?: AnthropicContentBlock[] };
      return parseAnthropicBlocks(json.content ?? []);
    }

    return this.readStream(response, request.onTextDelta);
  }

  private async readStream(
    response: Response,
    onTextDelta: (text: string) => void
  ): Promise<LlmCompletionResult> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Anthropic stream has no body");

    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    const toolAcc = new Map<number, { id: string; name: string; arguments: string }>();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        const event = JSON.parse(payload) as AnthropicStreamEvent;
        this.accumulateStreamEvent(event, toolAcc, (text) => {
          content += text;
          onTextDelta(text);
        });
      }
    }

    const toolCalls = [...toolAcc.values()].map((t) => ({
      id: t.id,
      name: t.name,
      arguments: parseJsonArguments(t.arguments)
    }));

    return { content, toolCalls };
  }

  private accumulateStreamEvent(
    event: AnthropicStreamEvent,
    toolAcc: Map<number, { id: string; name: string; arguments: string }>,
    onText: (text: string) => void
  ): void {
    if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
      const idx = event.index ?? toolAcc.size;
      toolAcc.set(idx, {
        id: event.content_block.id ?? "",
        name: event.content_block.name ?? "",
        arguments: ""
      });
    } else if (event.type === "content_block_delta") {
      if (event.delta?.type === "text_delta" && event.delta.text) {
        onText(event.delta.text);
      } else if (event.delta?.type === "input_json_delta" && event.delta.partial_json) {
        const idx = event.index ?? 0;
        const existing = toolAcc.get(idx) ?? { id: "", name: "", arguments: "" };
        existing.arguments += event.delta.partial_json;
        toolAcc.set(idx, existing);
      }
    }
  }
}

function parseAnthropicBlocks(blocks: AnthropicContentBlock[]): LlmCompletionResult {
  let content = "";
  const toolCalls: LlmCompletionResult["toolCalls"] = [];

  for (const block of blocks) {
    if (block.type === "text" && block.text) {
      content += block.text;
    } else if (block.type === "tool_use" && block.id && block.name) {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: block.input ?? {}
      });
    }
  }

  return { content, toolCalls };
}

function parseJsonArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return { _raw: raw };
  }
  return {};
}

function splitSystemAndMessages(messages: readonly LlmMessage[]): {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
} {
  const systemParts: string[] = [];
  const outMessages: Array<{ role: "user" | "assistant"; content: unknown }> = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      if (msg.content) systemParts.push(msg.content);
      continue;
    }

    if (msg.role === "tool") {
      outMessages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: msg.tool_call_id ?? "", content: msg.content ?? "" }]
      });
      continue;
    }

    if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
      const contentBlocks: unknown[] = [];
      if (msg.content) contentBlocks.push({ type: "text", text: msg.content });
      for (const tc of msg.tool_calls) {
        contentBlocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: parseJsonArguments(tc.function.arguments)
        });
      }
      outMessages.push({ role: "assistant", content: contentBlocks });
      continue;
    }

    outMessages.push({ role: msg.role, content: msg.content ?? "" });
  }

  return { system: systemParts.join("\n\n"), messages: outMessages };
}
