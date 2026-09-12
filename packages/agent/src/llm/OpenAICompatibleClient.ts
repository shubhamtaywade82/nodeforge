import type { LlmClient, LlmClientConfig, LlmCompletionRequest, LlmCompletionResult } from "./types.js";

interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
}

export class OpenAICompatibleClient implements LlmClient {
  constructor(private readonly config: LlmClientConfig) {}

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const body = {
      model: request.model || this.config.model,
      messages: request.messages,
      tools: request.tools,
      stream: Boolean(request.onTextDelta)
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify(body),
      signal: request.signal
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LLM request failed (${response.status}): ${text.slice(0, 500)}`);
    }

    if (!request.onTextDelta) {
      const json = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{
              id: string;
              function: { name: string; arguments: string };
            }>;
          };
        }>;
      };
      const message = json.choices?.[0]?.message;
      return parseAssistantMessage(message?.content ?? "", message?.tool_calls);
    }

    return this.readStream(response, request.onTextDelta);
  }

  private async readStream(
    response: Response,
    onTextDelta: (text: string) => void
  ): Promise<LlmCompletionResult> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("LLM stream has no body");
    }

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
        if (payload === "[DONE]") continue;
        const chunk = JSON.parse(payload) as StreamChunk;
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          content += delta.content;
          onTextDelta(delta.content);
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = toolAcc.get(tc.index) ?? { id: "", name: "", arguments: "" };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            toolAcc.set(tc.index, existing);
          }
        }
      }
    }

    const toolCalls = [...toolAcc.values()].map((t) => ({
      id: t.id,
      name: t.name,
      arguments: parseToolArguments(t.arguments)
    }));

    return { content, toolCalls };
  }
}

function parseAssistantMessage(
  content: string,
  rawCalls?: Array<{ id: string; function: { name: string; arguments: string } }>
): LlmCompletionResult {
  const toolCalls =
    rawCalls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: parseToolArguments(tc.function.arguments)
    })) ?? [];
  return { content, toolCalls };
}

function parseToolArguments(raw: string): Record<string, unknown> {
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
