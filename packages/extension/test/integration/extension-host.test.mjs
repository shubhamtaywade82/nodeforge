import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import * as vscode from "vscode";

const PROVIDER_VENDOR = "nodeforge-ollama";

let server;
let baseUrl;
let lastChatRequest;

suite("NodeForge Extension Host", () => {
  suiteSetup(async () => {
    server = createServer(async (request, response) => {
      if (request.url === "/api/tags" && request.method === "GET") {
        return sendJson(response, 200, {
          models: [
            {
              name: "gpt-oss:20b",
              modified_at: "2026-09-26T00:00:00Z",
              details: {
                family: "gpt-oss",
                parameter_size: "20B",
                quantization_level: "Q4_K_M"
              }
            }
          ]
        });
      }

      if (request.url === "/api/show" && request.method === "POST") {
        await consume(request);
        return sendJson(response, 200, {
          capabilities: ["completion", "tools"],
          modified_at: "2026-09-26T00:00:00Z",
          details: {
            family: "gpt-oss",
            parameter_size: "20B",
            quantization_level: "Q4_K_M"
          },
          model_info: {
            "gpt-oss.context_length": 131072
          }
        });
      }

      if (request.url === "/v1/chat/completions" && request.method === "POST") {
        const body = JSON.parse(await consume(request));
        lastChatRequest = body;
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        });

        if (Array.isArray(body.tools) && body.tools.length > 0) {
          response.write(
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"nodeforge_get_project_context","arguments":"{}"}}]}}]}\n\n'
          );
        } else {
          response.write('data: {"choices":[{"delta":{"content":"NodeForge OK"}}]}\n\n');
        }

        response.write("data: [DONE]\n\n");
        response.end();
        return;
      }

      response.writeHead(404);
      response.end();
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    baseUrl = "http://127.0.0.1:" + address.port;

    await vscode.workspace
      .getConfiguration("nodeforge.ollama")
      .update("baseUrl", baseUrl, vscode.ConfigurationTarget.Global);
  });

  suiteTeardown(async () => {
    await vscode.workspace
      .getConfiguration("nodeforge.ollama")
      .update("baseUrl", "http://localhost:11434", vscode.ConfigurationTarget.Global);

    server?.close();
    await once(server, "close");
  });

  test("activates the extension and registers native engineering tools", async () => {
    const extension = vscode.extensions.getExtension("nodeforge");
    assert.ok(extension, "NodeForge extension is installed in the Extension Host");

    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    for (const command of [
      "nodeforge.analyzeWorkspace",
      "nodeforge.runDiagnostics",
      "nodeforge.runTests",
      "nodeforge.refresh"
    ]) {
      assert.ok(commands.includes(command), "missing command: " + command);
    }

    const registeredTools = vscode.lm.tools.map(({ name }) => name);
    for (const tool of [
      "nodeforge_get_project_context",
      "nodeforge_get_diagnostics",
      "nodeforge_run_typecheck",
      "nodeforge_run_linter",
      "nodeforge_get_tests",
      "nodeforge_get_git_diff",
      "nodeforge_run_script",
      "nodeforge_format_workspace",
      "nodeforge_validate_workspace"
    ]) {
      assert.ok(registeredTools.includes(tool), "missing language model tool: " + tool);
    }
  });

  test("discovers the configured Ollama model through the native provider", async () => {
    const models = await vscode.lm.selectChatModels({ vendor: PROVIDER_VENDOR });

    assert.equal(models.length, 1);
    assert.equal(models[0].id, "gpt-oss:20b");
    assert.equal(models[0].family, "gpt-oss");
    assert.equal(models[0].vendor, PROVIDER_VENDOR);
    assert.equal(models[0].maxInputTokens, 122880);
    assert.equal(models[0].maxOutputTokens, 8192);
    assert.equal(models[0].toolCalling, true);
    assert.equal(models[0].imageInput, false);
  });

  test("streams text through the native Ollama provider", async () => {
    const [model] = await vscode.lm.selectChatModels({ vendor: PROVIDER_VENDOR });
    assert.ok(model);

    const response = await model.sendRequest(
      [vscode.LanguageModelChatMessage.User("Say hello")],
      {},
      new vscode.CancellationTokenSource().token
    );

    let text = "";
    for await (const part of response.text) text += part;

    assert.equal(text, "NodeForge OK");
    assert.equal(lastChatRequest?.model, "gpt-oss:20b");
    assert.equal(lastChatRequest?.stream, true);
  });

  test("maps VS Code tools to Ollama tool calls", async () => {
    const [model] = await vscode.lm.selectChatModels({ vendor: PROVIDER_VENDOR });
    assert.ok(model);

    const response = await model.sendRequest(
      [vscode.LanguageModelChatMessage.User("Inspect the project")],
      {
        tools: [
          {
            name: "nodeforge_get_project_context",
            description: "Read project context",
            inputSchema: {
              type: "object",
              properties: {}
            }
          }
        ],
        toolMode: vscode.LanguageModelChatToolMode.Required
      },
      new vscode.CancellationTokenSource().token
    );

    let toolCall;
    for await (const part of response.stream) {
      if (part instanceof vscode.LanguageModelToolCallPart) toolCall = part;
    }

    assert.ok(toolCall);
    assert.equal(toolCall.name, "nodeforge_get_project_context");
    assert.deepEqual(toolCall.input, {});
    assert.equal(lastChatRequest?.tool_choice, "required");
    assert.equal(lastChatRequest?.tools?.[0]?.function?.name, "nodeforge_get_project_context");
  });
});

function consume(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.setEncoding("utf8");
    request.on("data", (chunk) => chunks.push(chunk));
    request.once("end", () => resolve(chunks.join("")));
    request.once("error", reject);
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}
