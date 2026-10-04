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

// ─── image input, cache, connection test ───

import {
  MAX_IMAGE_BYTES,
  TtlCache,
  testOllamaConnection,
  toImageDataUrl
} from "../src/ai/ollamaProviderUtils.ts";

test("encodes supported images as data URLs", () => {
  assert.equal(toImageDataUrl("image/png", new Uint8Array([1, 2, 3])), "data:image/png;base64,AQID");
  assert.equal(toImageDataUrl("IMAGE/JPEG", new Uint8Array([255])), "data:image/jpeg;base64,/w==");
});

test("rejects unsupported, empty and oversized images", () => {
  assert.throws(() => toImageDataUrl("image/svg+xml", new Uint8Array([1])), /Unsupported image type/);
  assert.throws(() => toImageDataUrl("application/json", new Uint8Array([1])), /Unsupported image type/);
  assert.throws(() => toImageDataUrl("image/png", new Uint8Array()), /empty/);
  assert.throws(() => toImageDataUrl("image/png", new Uint8Array(MAX_IMAGE_BYTES + 1)), /limit/);
});

test("TtlCache reuses fresh entries, shares in-flight loads and expires", async () => {
  let t = 0;
  let loads = 0;
  const cache = new TtlCache<number>(1000, () => t);
  const load = async (): Promise<number> => ++loads;

  const [a, b] = await Promise.all([cache.get("k", load), cache.get("k", load)]);
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(await cache.get("k", load), 1);
  t = 1001;
  assert.equal(await cache.get("k", load), 2);
  cache.clear();
  assert.equal(await cache.get("k", load), 3);
});

test("TtlCache does not cache failures", async () => {
  let calls = 0;
  const cache = new TtlCache<number>(1000, () => 0);
  await assert.rejects(cache.get("k", async () => { calls++; throw new Error("down"); }), /down/);
  assert.equal(await cache.get("k", async () => { calls++; return 7; }), 7);
  assert.equal(calls, 2);
});

test("testOllamaConnection reports success, HTTP errors and network failures", async () => {
  const ok = await testOllamaConnection("http://h:1", (async () => new Response(JSON.stringify({ models: [{}, {}] }))) as typeof fetch);
  assert.deepEqual([ok.ok, ok.modelCount], [true, 2]);
  assert.match(ok.message, /2 models/);

  const http = await testOllamaConnection("http://h:1", (async () => new Response("no", { status: 401 })) as typeof fetch);
  assert.equal(http.ok, false);
  assert.match(http.message, /HTTP 401/);

  const down = await testOllamaConnection("http://h:1", (async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch);
  assert.equal(down.ok, false);
  assert.match(down.message, /ECONNREFUSED/);
});
