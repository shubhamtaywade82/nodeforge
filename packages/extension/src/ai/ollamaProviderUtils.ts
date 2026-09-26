export interface OllamaTagModel {
  readonly name: string;
  readonly modified_at?: string;
  readonly details?: {
    readonly family?: string;
    readonly parameter_size?: string;
    readonly quantization_level?: string;
  };
}

export interface OllamaShowModel {
  readonly modified_at?: string;
  readonly capabilities?: readonly string[];
  readonly details?: {
    readonly family?: string;
    readonly parameter_size?: string;
    readonly quantization_level?: string;
  };
  readonly model_info?: Readonly<Record<string, unknown>>;
}

export interface OllamaModelMetadata {
  readonly id: string;
  readonly name: string;
  readonly family: string;
  readonly version: string;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly toolCalling: boolean;
  readonly imageInput: boolean;
  readonly tooltip: string;
  readonly detail: string;
}

const DEFAULT_CONTEXT_LENGTH = 8192;
const MAX_OUTPUT_TOKENS = 8192;

export function toOllamaApiBaseUrl(baseUrl: string): string {
  const normalized = stripTrailingSlash(baseUrl).replace(/\\/v1$/, "");
  return normalized + "/api";
}

export function toOllamaOpenAiBaseUrl(baseUrl: string): string {
  const normalized = stripTrailingSlash(baseUrl).replace(/\\/v1$/, "");
  return normalized + "/v1";
}

export function extractContextLength(model: OllamaShowModel): number {
  const values = Object.entries(model.model_info ?? {})
    .filter(([key, value]) => key.endsWith(".context_length") && typeof value === "number" && Number.isFinite(value))
    .map(([, value]) => Math.trunc(value as number))
    .filter((value) => value > 0);

  return values.length > 0 ? Math.max(...values) : DEFAULT_CONTEXT_LENGTH;
}

export function buildOllamaModelMetadata(
  tag: OllamaTagModel,
  show: OllamaShowModel = {}
): OllamaModelMetadata {
  const contextLength = extractContextLength(show);
  const maxOutputTokens = Math.min(
    MAX_OUTPUT_TOKENS,
    Math.max(1024, Math.floor(contextLength / 4))
  );
  const maxInputTokens = Math.max(1024, contextLength - maxOutputTokens);
  const family = show.details?.family ?? tag.details?.family ?? "ollama";
  const capabilities = new Set(show.capabilities ?? []);
  const modifiedAt = show.modified_at ?? tag.modified_at ?? "unknown";
  const parameterSize = show.details?.parameter_size ?? tag.details?.parameter_size;
  const quantization = show.details?.quantization_level ?? tag.details?.quantization_level;
  const detail = [family, parameterSize, quantization].filter(Boolean).join(" · ");

  return {
    id: tag.name,
    name: tag.name,
    family,
    version: modifiedAt,
    maxInputTokens,
    maxOutputTokens,
    toolCalling: capabilities.has("tools"),
    imageInput: capabilities.has("vision"),
    tooltip: [
      "Ollama: " + tag.name,
      "context " + contextLength.toLocaleString() + " tokens",
      capabilities.size > 0 ? "capabilities: " + [...capabilities].join(", ") : "capabilities unavailable"
    ].join(" · "),
    detail: detail || "Ollama model"
  };
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\\+$/, "");
}
