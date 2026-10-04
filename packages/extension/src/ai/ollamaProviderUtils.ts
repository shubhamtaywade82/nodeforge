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
  const normalized = stripTrailingSlash(baseUrl).replace(/\/v1$/, "");
  return normalized + "/api";
}

export function toOllamaOpenAiBaseUrl(baseUrl: string): string {
  const normalized = stripTrailingSlash(baseUrl).replace(/\/v1$/, "");
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
  return value.replace(/\/+$/, "");
}

// ─── Image input ───

export const SUPPORTED_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp"
]);
/** Ollama decodes images in memory; refuse absurdly large attachments up front. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Encodes an image as a `data:` URL, validating type and size. */
export function toImageDataUrl(mimeType: string, data: Uint8Array): string {
  const mime = mimeType.toLowerCase();
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(mime)) {
    throw new Error(
      `Unsupported image type "${mimeType}". Supported: ${[...SUPPORTED_IMAGE_MIME_TYPES].join(", ")}.`
    );
  }
  if (data.byteLength === 0) throw new Error("Image attachment is empty.");
  if (data.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Image attachment is ${data.byteLength} bytes; the limit is ${MAX_IMAGE_BYTES}.`);
  }
  return `data:${mime};base64,${Buffer.from(data).toString("base64")}`;
}

// ─── Short-lived cache for model discovery ───

/** Tiny TTL cache with an injectable clock. Failed loads are never cached. */
export class TtlCache<T> {
  private readonly entries = new Map<string, { readonly value: Promise<T>; readonly expires: number }>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  // No parameter properties: this file runs under Node's strip-only TypeScript mode in tests.
  constructor(ttlMs: number, now: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  /** Concurrent callers share one in-flight load. */
  get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > this.now()) return hit.value;

    const value = load();
    this.entries.set(key, { value, expires: this.now() + this.ttlMs });
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}

// ─── Connection test ───

export interface OllamaConnectionResult {
  readonly ok: boolean;
  readonly modelCount: number;
  readonly message: string;
}

export async function testOllamaConnection(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 5000
): Promise<OllamaConnectionResult> {
  const url = toOllamaApiBaseUrl(baseUrl) + "/tags";
  try {
    const response = await fetchImpl(url, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      return { ok: false, modelCount: 0, message: `Ollama answered HTTP ${response.status} at ${url}.` };
    }
    const body = (await response.json()) as { models?: unknown[] };
    const modelCount = Array.isArray(body.models) ? body.models.length : 0;
    return {
      ok: true,
      modelCount,
      message: `Connected to Ollama at ${baseUrl} (${modelCount} model${modelCount === 1 ? "" : "s"}).`
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, modelCount: 0, message: `Could not reach Ollama at ${baseUrl}: ${detail}` };
  }
}
