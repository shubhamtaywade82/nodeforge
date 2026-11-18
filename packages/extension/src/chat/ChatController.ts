import * as vscode from "vscode";
import type { ChatMessage, ToolInvocationRecord } from "@nodeforge/contracts";
import {
  AgentLoop,
  AnthropicClient,
  ChatCancelledError,
  OpenAICompatibleClient,
  findPromptByName
} from "@nodeforge/agent";
import type { ExtensionWorkspaceSession } from "../core/ExtensionWorkspaceSession.js";

export type AiProvider = "openai" | "anthropic" | "ollama";

export interface ChatRunCallbacks {
  onAssistantDelta: (text: string) => void;
  onToolStart: (name: string) => void;
  onToolEnd: (record: ToolInvocationRecord) => void;
  onDone: (assistantText: string) => void;
  onError: (message: string) => void;
}

export interface ChatControllerConfig {
  provider?: AiProvider;
  baseUrl: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  maxToolRounds: number;
  injectWorkspaceSnapshot: boolean;
}

export class ChatController {
  private history: ChatMessage[] = [];
  private activeAbort: AbortController | undefined;

  constructor(
    private readonly session: ExtensionWorkspaceSession,
    private readonly getApiKey: (provider?: AiProvider) => Promise<string | undefined>,
    private readonly isTrusted: () => boolean
  ) {}

  clearHistory(): void {
    this.history = [];
  }

  cancel(): void {
    this.activeAbort?.abort();
    this.activeAbort = undefined;
  }

  async runUserMessage(text: string, config: ChatControllerConfig, callbacks: ChatRunCallbacks): Promise<void> {
    const provider = config.provider ?? "openai";
    const apiKey = (await this.getApiKey(provider)) || (provider === "ollama" ? "ollama" : undefined);
    if (!apiKey) {
      callbacks.onError(`No ${provider} API key configured. Run "NodeForge: Set AI Provider API Key" first.`);
      return;
    }

    const ctx = this.session.getContext();
    if (!ctx) {
      callbacks.onError("Open a workspace folder first.");
      return;
    }

    const userText = expandSlashCommand(text);
    this.history.push({ role: "user", content: userText });

    const client = provider === "anthropic"
      ? new AnthropicClient({ apiKey, baseUrl: config.baseUrl, model: config.model })
      : new OpenAICompatibleClient({ apiKey, baseUrl: config.baseUrl, model: config.model });
    const loop = new AgentLoop(client, ctx, config.model);

    const controller = new AbortController();
    this.activeAbort = controller;

    let assistantText = "";

    try {
      const workspaceJson =
        config.injectWorkspaceSnapshot ? await this.session.snapshotJson() : undefined;

      const result = await loop.runTurn(userText, this.history.slice(0, -1), {
        maxToolRounds: config.maxToolRounds,
        workspaceTrusted: this.isTrusted(),
        workspaceContextJson: workspaceJson,
        modelOptions: {
          ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
          ...(config.maxTokens !== undefined ? { max_tokens: config.maxTokens } : {})
        },
        signal: controller.signal,
        onTextDelta: (delta) => {
          assistantText += delta;
          callbacks.onAssistantDelta(delta);
        },
        onToolStart: callbacks.onToolStart,
        onToolEnd: callbacks.onToolEnd,
        requestToolApproval: async (toolName) => {
          const choice = await vscode.window.showWarningMessage(
            `NodeForge wants to perform "${toolName}".`,
            { modal: true },
            "Allow once"
          );
          return choice === "Allow once";
        }
      });

      assistantText = result.assistantMessage || assistantText;
      this.history.push({ role: "assistant", content: assistantText });
      callbacks.onDone(assistantText);
    } catch (err) {
      if (err instanceof ChatCancelledError) {
        callbacks.onError("Cancelled.");
        return;
      }
      callbacks.onError(err instanceof Error ? err.message : String(err));
    } finally {
      this.activeAbort = undefined;
    }
  }
}

function expandSlashCommand(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return text;

  const name = trimmed.slice(1).split(/\s+/)[0] ?? "";
  const prompt = findPromptByName(name);
  if (!prompt) return text;
  return prompt.message;
}
