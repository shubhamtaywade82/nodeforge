export interface LlmToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface LlmCompletionRequest {
  messages: LlmMessage[];
  tools: LlmToolDefinition[];
  model: string;
  signal?: AbortSignal;
  onTextDelta?: (text: string) => void;
}

export interface LlmCompletionResult {
  content: string;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
}

export interface LlmClientConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface LlmClient {
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
}
