const assert = require("node:assert");
const vscode = require("vscode");
const { activateExtension } = require("../../lib/helpers");

const PARTICIPANT = "nodeforge.engineer";

/** A model that scripts what the LLM would say, and records what it was sent. */
function fakeModel(script) {
  const seen = [];
  return {
    seen,
    sendRequest: async (messages) => {
      seen.push(messages);
      const parts = script.shift() ?? [new vscode.LanguageModelTextPart("(no more script)")];
      return {
        stream: (async function* () {
          for (const p of parts) yield p;
        })()
      };
    }
  };
}

const fakeStream = () => ({ markdown() {}, progress() {} });
const request = (model, prompt, command) => ({ prompt, command, model, references: [], toolInvocationToken: undefined });
const token = () => new vscode.CancellationTokenSource().token;

suite("@nodeforge participant (driven with a fake model)", () => {
  let handle;

  suiteSetup(async () => {
    const ext = await activateExtension();
    handle = ext.exports.__testing.handleParticipantRequest;
    assert.strictEqual(typeof handle, "function");
  });

  test("runs the tool loop, streams the answer and records a structured tool trace", async () => {
    const model = fakeModel([
      [new vscode.LanguageModelToolCallPart("call-1", "nodeforge_get_project_context", {})],
      [new vscode.LanguageModelTextPart("It is a TypeScript project.")]
    ]);
    const result = await handle(request(model, "what is this project?"), { history: [] }, fakeStream(), token(), true);

    assert.strictEqual(model.seen.length, 2, "one tool round, then the final answer");
    const trace = result.metadata.toolTrace;
    assert.ok(trace, "result metadata must carry the tool trace");
    assert.strictEqual(trace.rounds.length, 1);
    assert.strictEqual(trace.rounds[0].calls[0].name, "nodeforge_get_project_context");
    assert.match(trace.rounds[0].results[0].text, /"typescript": true/);
    // The trace must survive being stored as chat-result metadata.
    assert.doesNotThrow(() => JSON.stringify(result.metadata));
  });

  test("replays earlier tool evidence next turn as real tool call/result messages", async () => {
    const first = fakeModel([
      [new vscode.LanguageModelToolCallPart("call-1", "nodeforge_get_project_context", {})],
      [new vscode.LanguageModelTextPart("It is a TypeScript project.")]
    ]);
    const firstResult = await handle(request(first, "what is this project?"), { history: [] }, fakeStream(), token(), true);

    const history = [
      new vscode.ChatRequestTurn("what is this project?", undefined, [], PARTICIPANT, []),
      new vscode.ChatResponseTurn([new vscode.ChatResponseMarkdownPart("It is a TypeScript project.")], firstResult, PARTICIPANT)
    ];
    const second = fakeModel([[new vscode.LanguageModelTextPart("npm.")]]);
    await handle(request(second, "and the package manager?"), { history }, fakeStream(), token(), true);

    const sent = second.seen[0].flatMap((m) => m.content);
    const call = sent.find((p) => p instanceof vscode.LanguageModelToolCallPart);
    const result = sent.find((p) => p instanceof vscode.LanguageModelToolResultPart);
    assert.ok(call, "the earlier tool call must be replayed");
    assert.strictEqual(call.name, "nodeforge_get_project_context");
    assert.ok(result, "the earlier tool result must be replayed");
    assert.strictEqual(result.callId, call.callId);
    const resultText = result.content.map((c) => c.value).join("");
    assert.match(resultText, /earlier turn/);
    assert.match(resultText, /"typescript": true/);
  });

  test("ignores history that belongs to other chat participants", async () => {
    const history = [
      new vscode.ChatRequestTurn("secret question for another participant", undefined, [], "someone.else", []),
      new vscode.ChatResponseTurn([new vscode.ChatResponseMarkdownPart("secret answer")], {}, "someone.else")
    ];
    const model = fakeModel([[new vscode.LanguageModelTextPart("ok")]]);
    await handle(request(model, "hello"), { history }, fakeStream(), token(), true);
    const text = JSON.stringify(model.seen[0].flatMap((m) => m.content.map((c) => c.value ?? "")));
    assert.ok(!text.includes("secret"), "another participant's turns must not be replayed");
  });

  test("a failing tool is reported to the model as data and the loop continues", async () => {
    const model = fakeModel([
      [new vscode.LanguageModelToolCallPart("c1", "nodeforge_read_file", { path: ".env" })],
      [new vscode.LanguageModelTextPart("I cannot read that file.")]
    ]);
    const result = await handle(request(model, "read .env"), { history: [] }, fakeStream(), token(), true);
    const text = result.metadata.toolTrace.rounds[0].results[0].text;
    assert.match(text, /PATH_DENIED/);
    assert.strictEqual(model.seen.length, 2);
  });

  test("stops after the configured number of tool rounds and says so", async () => {
    const chunks = [];
    const stream = { markdown: (t) => chunks.push(t), progress() {} };
    const forever = Array.from({ length: 40 }, (_, i) => [new vscode.LanguageModelToolCallPart(`c${i}`, "nodeforge_get_project_context", {})]);
    const result = await handle(request(fakeModel(forever), "loop"), { history: [] }, stream, token(), true);
    assert.strictEqual(result.metadata.truncated, true);
    assert.match(chunks.join(""), /Stopped after \d+ tool rounds/);
    assert.ok(result.metadata.toolTrace.rounds.length <= 6, "the stored trace stays bounded");
  });
});
