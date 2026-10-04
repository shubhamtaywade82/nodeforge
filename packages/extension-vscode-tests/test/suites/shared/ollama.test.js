const assert = require("node:assert");
const { createServer } = require("node:http");

const vscode = require("vscode");
const { activateExtension, waitFor } = require("../../lib/helpers");

const OLLAMA_VENDOR = "nodeforge-ollama";

function readBody(req                 )                  {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c        ) => (data += c.toString("utf8")));
    req.on("end", () => resolve(data));
  });
}

suite("Ollama model provider (stub server)", () => {
  let server        ;
  const chatBodies = [];

  suiteSetup(async () => {
    await activateExtension();
    server = createServer((req, res) => {
      void (async () => {
        if (req.url === "/api/tags") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ models: [{ name: "stub:1b" }] }));
        } else if (req.url === "/api/show") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              details: { family: "stub", parameter_size: "1B" },
              model_info: { "stub.context_length": 32768 },
              capabilities: ["completion", "tools"]
            })
          );
        } else if (req.url === "/v1/chat/completions") {
          // NodeForge's Ollama provider streams through Ollama's OpenAI-compatible endpoint (SSE).
          chatBodies.push(JSON.parse(await readBody(req)));
          res.writeHead(200, { "content-type": "text/event-stream" });
          for (const content of ["pong ", "from stub"]) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
          }
          res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
          res.end("data: [DONE]\n\n");
        } else {
          res.writeHead(404).end();
        }
      })();
    });
    await new Promise      ((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address()               ).port;
    await vscode.workspace
      .getConfiguration("nodeforge.ollama")
      .update("baseUrl", `http://127.0.0.1:${port}`, vscode.ConfigurationTarget.Global);
  });

  suiteTeardown(async () => {
    await vscode.workspace.getConfiguration("nodeforge.ollama").update("baseUrl", undefined, vscode.ConfigurationTarget.Global);
    await new Promise      ((resolve) => server.close(() => resolve()));
  });

  test("lists Ollama models with capabilities from /api/show", async () => {
    const models = await waitFor(async () => {
      const found = await vscode.lm.selectChatModels({ vendor: OLLAMA_VENDOR });
      return found.length > 0 ? found : undefined;
    }, "the stub Ollama model");
    const model = models[0] ;
    assert.strictEqual(model.id, "stub:1b");
    assert.strictEqual(model.family, "stub");
    assert.ok(model.maxInputTokens > 0 && model.maxInputTokens < 32768);
  });

  test("streams a chat response through /v1/chat/completions", async () => {
    const [model] = await vscode.lm.selectChatModels({ vendor: OLLAMA_VENDOR });
    assert.ok(model, "no Ollama model available");
    const source = new vscode.CancellationTokenSource();
    const response = await model.sendRequest([vscode.LanguageModelChatMessage.User("ping")], {}, source.token);
    let text = "";
    for await (const chunk of response.text) text += chunk;
    source.dispose();
    assert.strictEqual(text, "pong from stub");
    const sent = chatBodies.at(-1);
    assert.strictEqual(sent?.model, "stub:1b");
    assert.strictEqual(sent?.stream, true);
    const last = sent?.messages.at(-1);
    assert.strictEqual(last?.role, "user");
    assert.match(JSON.stringify(last?.content), /ping/);
  });

  test("counts tokens without calling the server", async () => {
    const [model] = await vscode.lm.selectChatModels({ vendor: OLLAMA_VENDOR });
    assert.ok(model);
    const n = await model.countTokens("12345678");
    assert.strictEqual(n, 2);
  });
});
