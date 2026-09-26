import * as vscode from "vscode";
import { OpenAICompatibleClient, type LlmMessage, type LlmToolDefinition } from "@nodeforge/agent";
import {
  buildOllamaModelMetadata,
  toOllamaApiBaseUrl,
  toOllamaOpenAiBaseUrl,
  type OllamaShowModel,
  type OllamaTagModel
} from "./ollamaProviderUtils.js";

export const OLLAMA_LANGUAGE_MODEL_VENDOR = "nodeforge-ollama";
export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

interface OllamaTagsResponse {
  readonly models?: readonly OllamaTagModel[];
}

interface OllamaProviderConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
}

export class OllamaLanguageModelChatProvider implements vscode.LanguageModelChatProvider {
  constructor(
    private readonly getConfig: () => OllamaProviderConfig = () => ({
      baseUrl: DEFAULT_OLLAMA_BASE_URL,
      apiKey: "ollama"
    })
  ) {}

  async provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const cancellation = createAbortController(token);
    try {
      const config = this.getConfig();
      const tags = await this.fetchJson<OllamaTagsResponse>(
        toOllamaApiBaseUrl(config.baseUrl) + "/tags",
        { method: "GET", signal: cancellation.signal }
      );
      const models = tags.models ?? [];

      const enriched = await Promise.all(
        models.map(async (model) => {
          try {
            const show = await this.fetchJson<OllamaShowModel>(
              toOllamaApiBaseUrl(config.baseUrl) + "/show",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model: model.name }),
                signal: cancellation.signal
              }
            );
            return buildOllamaModelMetadata(model, show);
          } catch {
            return buildOllamaModelMetadata(model);
          }
        })
      );

      return enriched.map((metadata) => ({
        id: metadata.id,
        name: metadata.name,
        family: metadata.family,
        version: metadata.version,
        maxInputTokens: metadata.maxInputTokens,
        maxOutputTokens: metadata.maxOutputTokens,
        tooltip: metadata.tooltip,
        detail: metadata.detail,
        capabilities: {
          imageInput: metadata.imageInput,
          toolCalling: metadata.toolCalling
        }
      }));
    } catch (error) {
      if (token.isCancellationRequested) return [];
      if (options.silent) return [];
      throw new Error(formatOllamaConnectionError(this.getConfig().baseUrl, error));
    } finally {
      cancellation.dispose();
    }
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const config = this.getConfig();
    const cancellation = createAbortController(token);
    try {
      const llmMessages = toLlmMessages(messages);
      const tools = (options.tools ?? []).map<LlmToolDefinition>((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema ?? { type: "object", properties: {} }
        }
      }));

      if (options.toolMode === vscode.LanguageModelChatToolMode.Required && tools.length === 0) {
        throw new Error("Ollama provider received Required tool mode without any tools.");
      }

      const client = new OpenAICompatibleClient({
        apiKey: config.apiKey,
        baseUrl: toOllamaOpenAiBaseUrl(config.baseUrl),
        model: model.id
      });

      const result = await client.complete({
        messages: llmMessages,
        tools,
        model: model.id,
        modelOptions: isRecord(options.modelOptions) ? options.modelOptions : undefined,
        toolChoice:
          tools.length === 0
            ? undefined
            : options.toolMode === vscode.LanguageModelChatToolMode.Required
              ? "required"
              : "auto",
        signal: cancellation.signal,
        onTextDelta: (delta) => progress.report(new vscode.LanguageModelTextPart(delta))
      });

      for (const toolCall of result.toolCalls) {
        progress.report(
          new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.name, toolCall.arguments)
        );
      }
    } catch (error) {
      if (token.isCancellationRequested) return;
      throw error;
    } finally {
      cancellation.dispose();
    }
  }

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
    const value =
      typeof text === "string"
        ? text
        : text.content
            .filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
            .map((part) => part.value)
            .join("");
    return Math.max(1, Math.ceil(value.length / 4));
  }

  private async fetchJson<T>(
    url: string,
    init: RequestInit
  ): Promise<T> {
    const response = await fetch(url, init);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
    }
    return (await response.json()) as T;
  }
}

export function registerOllamaLanguageModelChatProvider(): vscode.Disposable {
  const provider = new OllamaLanguageModelChatProvider(() => {
    const configuration = vscode.workspace.getConfiguration("nodeforge.ollama");
    return {
      baseUrl: configuration.get<string>("baseUrl", DEFAULT_OLLAMA_BASE_URL),
      apiKey: process.env.OLLAMA_API_KEY ?? "ollama"
    };
  });

  return vscode.lm.registerLanguageModelChatProvider(OLLAMA_LANGUAGE_MODEL_VENDOR, provider);
}

function toLlmMessages(
  messages: readonly vscode.LanguageModelChatRequestMessage[]
): LlmMessage[] {
  const result: LlmMessage[] = [];

  for (const message of messages) {
    const text: string[] = [];
    const toolCalls: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }> = [];
    const toolResults: vscode.LanguageModelToolResultPart[] = [];

    for (const part of message.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        text.push(part.value);
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        toolCalls.push({
          id: part.callId,
          type: "function",
          function: {
            name: part.name,
            arguments: JSON.stringify(part.input)
          }
        });
      } else if (part instanceof vscode.LanguageModelToolResultPart) {
        toolResults.push(part);
      } else if (typeof part === "string") {
        text.push(part);
      } else {
        throw new Error(
          "Ollama provider supports text and tool messages only; unsupported message content was received."
        );
      }
    }

    if (message.role === vscode.LanguageModelChatMessageRole.Assistant) {
      result.push({
        role: "assistant",
        content: text.join("") || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
      });
      continue;
    }

    if (toolResults.length > 0) {
      if (text.length > 0) {
        result.push({ role: "user", content: text.join("") });
      }
      for (const toolResult of toolResults) {
        result.push({
          role: "tool",
          content: stringifyToolResult(toolResult.content),
          tool_call_id: toolResult.callId
        });
      }
      continue;
    }

    result.push({ role: "user", content: text.join("") });
  }

  return result;
}

function stringifyToolResult(content: readonly unknown[]): string {
  const parts = content.map((part) => {
    if (part instanceof vscode.LanguageModelTextPart) return part.value;
    if (typeof part === "string") return part;
    try {
      return JSON.stringify(part);
    } catch {
      return String(part);
    }
  });

  return parts.join("");
}

function createAbortController(token: vscode.CancellationToken): {
  readonly signal: AbortSignal;
  readonly dispose: () => void;
} {
  const controller = new AbortController();
  const disposable = token.onCancellationRequested(() => controller.abort());
  if (token.isCancellationRequested) controller.abort();

  return {
    signal: controller.signal,
    dispose: () => disposable.dispose()
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatOllamaConnectionError(baseUrl: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `Unable to connect to Ollama at ${baseUrl}. Start Ollama or set nodeforge.ollama.baseUrl. ${detail}`;
}
