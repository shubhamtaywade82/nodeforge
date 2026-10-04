import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleClient } from "../src/llm/OpenAICompatibleClient.js";

describe("OpenAICompatibleClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards tool choice and model options without overriding protocol fields", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "done" } }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenAICompatibleClient({
      apiKey: "ollama",
      baseUrl: "http://localhost:11434/v1",
      model: "gpt-oss:20b"
    });

    await client.complete({
      messages: [{ role: "user", content: "inspect this" }],
      tools: [
        {
          type: "function",
          function: {
            name: "inspect",
            description: "Inspect the workspace",
            parameters: { type: "object" }
          }
        }
      ],
      model: "gpt-oss:20b",
      modelOptions: { temperature: 0.2, model: "must-not-win" },
      toolChoice: "required"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toEqual({
      temperature: 0.2,
      model: "gpt-oss:20b",
      messages: [{ role: "user", content: "inspect this" }],
      tools: [
        {
          type: "function",
          function: {
            name: "inspect",
            description: "Inspect the workspace",
            parameters: { type: "object" }
          }
        }
      ],
      tool_choice: "required",
      stream: false
    });
  });
});
