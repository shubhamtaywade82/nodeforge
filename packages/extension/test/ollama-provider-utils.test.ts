import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOllamaModelMetadata,
  extractContextLength,
  toOllamaApiBaseUrl,
  toOllamaOpenAiBaseUrl
} from "../src/ai/ollamaProviderUtils.ts";

test("normalizes Ollama endpoint URLs", () => {
  assert.equal(toOllamaApiBaseUrl("http://localhost:11434/"), "http://localhost:11434/api");
  assert.equal(toOllamaApiBaseUrl("http://localhost:11434/v1"), "http://localhost:11434/api");
  assert.equal(toOllamaOpenAiBaseUrl("http://localhost:11434"), "http://localhost:11434/v1");
  assert.equal(toOllamaOpenAiBaseUrl("http://localhost:11434/v1/"), "http://localhost:11434/v1");
});

test("extracts Ollama model context length from model_info", () => {
  assert.equal(
    extractContextLength({
      model_info: {
        "general.context_length": 4096,
        "llama.context_length": 32768
      }
    }),
    32768
  );
  assert.equal(extractContextLength({}), 8192);
});

test("maps model capabilities and token limits", () => {
  const metadata = buildOllamaModelMetadata(
    {
      name: "gpt-oss:20b",
      modified_at: "2026-09-26T00:00:00Z",
      details: { family: "gpt-oss", parameter_size: "20B", quantization_level: "Q4_K_M" }
    },
    {
      capabilities: ["completion", "tools"],
      model_info: { "gpt-oss.context_length": 131072 },
      modified_at: "2026-09-26T00:00:00Z"
    }
  );

  assert.equal(metadata.id, "gpt-oss:20b");
  assert.equal(metadata.family, "gpt-oss");
  assert.equal(metadata.toolCalling, true);
  assert.equal(metadata.imageInput, false);
  assert.equal(metadata.maxInputTokens + metadata.maxOutputTokens, 131072);
  assert.match(metadata.detail, /20B/);
});
