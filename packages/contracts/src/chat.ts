/**
 * Built-in NodeForge chat contracts (UI-agnostic).
 */

export type ChatRole = "user" | "assistant" | "system" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Tool name when role is `tool`. */
  toolName?: string;
  /** Present when the assistant invoked tools. */
  toolCallId?: string;
}

export interface ToolInvocationRecord {
  name: string;
  arguments: Record<string, unknown>;
  result: string;
  ok: boolean;
  durationMs: number;
}

export interface ChatTurnResult {
  assistantMessage: string;
  toolInvocations: ToolInvocationRecord[];
  cancelled: boolean;
}
