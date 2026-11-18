import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnthropicClient, resolveAnthropicUrl } from "../src/llm/AnthropicClient.js";

describe("AnthropicClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("resolveAnthropicUrl", () => {
    it("appends /v1/messages to root HTTPS URL", () => {
      expect(resolveAnthropicUrl("https://api.anthropic.com")).toBe("https://api.anthropic.com/v1/messages");
      expect(resolveAnthropicUrl("https://api.anthropic.com/")).toBe("https://api.anthropic.com/v1/messages");
    });

    it("appends /messages when /v1 is provided", () => {
      expect(resolveAnthropicUrl("https://proxy.example.com/v1")).toBe("https://proxy.example.com/v1/messages");
    });

    it("keeps full /v1/messages path", () => {
      expect(resolveAnthropicUrl("https://proxy.example.com/v1/messages")).toBe("https://proxy.example.com/v1/messages");
    });

    it("allows localhost and 127.0.0.1 on http", () => {
      expect(resolveAnthropicUrl("http://localhost:8080")).toBe("http://localhost:8080/v1/messages");
      expect(resolveAnthropicUrl("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080/v1/messages");
    });

    it("rejects non-HTTPS public URLs", () => {
      expect(() => resolveAnthropicUrl("http://insecure-gateway.com")).toThrow("HTTPS is required");
    });
  });

  describe("complete", () => {
    it("sends Anthropic headers, converts tools, and parses text and tool_use blocks", async () => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            content: [
              { type: "text", text: "Analyzing repository..." },
              { type: "tool_use", id: "call_1", name: "searchFiles", input: { query: "export const" } }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
      vi.stubGlobal("fetch", fetchMock);

      const client = new AnthropicClient({
        apiKey: "sk-ant-test",
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet-4-5"
      });

      const result = await client.complete({
        messages: [
          { role: "system", content: "You are NodeForge" },
          { role: "user", content: "Search the codebase" }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "searchFiles",
              description: "Search files",
              parameters: { type: "object", properties: { query: { type: "string" } } }
            }
          }
        ],
        model: "claude-sonnet-4-5",
        toolChoice: "auto"
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] ?? [];
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      const headers = init?.headers as Record<string, string>;
      expect(headers["x-api-key"]).toBe("sk-ant-test");
      expect(headers["anthropic-version"]).toBe("2023-06-01");

      const body = JSON.parse(String(init?.body));
      expect(body.system).toBe("You are NodeForge");
      expect(body.model).toBe("claude-sonnet-4-5");
      expect(body.tools[0].name).toBe("searchFiles");
      expect(body.tool_choice).toEqual({ type: "auto" });

      expect(result.content).toBe("Analyzing repository...");
      expect(result.toolCalls).toEqual([
        { id: "call_1", name: "searchFiles", arguments: { query: "export const" } }
      ]);
    });

    it("handles tool results sent as user messages", async () => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ content: [{ type: "text", text: "Got results" }] }), { status: 200 })
      );
      vi.stubGlobal("fetch", fetchMock);

      const client = new AnthropicClient({
        apiKey: "sk-ant-test",
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet-4-5"
      });

      await client.complete({
        messages: [
          { role: "user", content: "read" },
          { role: "tool", tool_call_id: "call_1", content: "file content" }
        ],
        tools: [],
        model: "claude-sonnet-4-5"
      });

      const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
      expect(body.messages[1]).toEqual({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "call_1", content: "file content" }]
      });
    });

    it("throws clear error on non-ok status", async () => {
      vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
        new Response("Unauthorized API key", { status: 401 })
      ));

      const client = new AnthropicClient({
        apiKey: "bad-key",
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet-4-5"
      });

      await expect(client.complete({ messages: [], tools: [], model: "claude-sonnet-4-5" })).rejects.toThrow(
        "Anthropic request failed (401)"
      );
    });
  });
});
