const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");
const { activateExtension, invokeTool, workspaceRoot } = require("../../lib/helpers");

suite("Restricted Mode (untrusted workspace)", () => {
  suiteSetup(async () => {
    await activateExtension();
  });

  test("the workspace is untrusted", () => {
    assert.strictEqual(vscode.workspace.isTrusted, false);
  });

  test("read-only project inspection still works", async () => {
    const profile = JSON.parse(await invokeTool("nodeforge_get_project_context"))                    ;
    assert.strictEqual(profile.root, workspaceRoot());
  });

  test("tools that execute project code are refused", async () => {
    for (const name of ["nodeforge_get_diagnostics", "nodeforge_run_typecheck", "nodeforge_get_tests", "nodeforge_validate_workspace"]) {
      const text = await invokeTool(name);
      // The central tool policy (packages/agent toolPolicy) refuses execution for untrusted callers.
      assert.match(text, /disabled|not trusted/i, `${name} was not refused: ${text.slice(0, 200)}`);
    }
  });

  test("the diagnostics report refuses to run tooling", async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.from({ scheme: "nodeforge", path: "/diagnostics.md" }));
    assert.match(doc.getText(), /Restricted Mode/);
  });

  test("the profile report still renders", async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.from({ scheme: "nodeforge", path: "/profile.json" }));
    assert.doesNotThrow(() => JSON.parse(doc.getText()));
  });

  test("read-only source tools still work in Restricted Mode", async () => {
    const read = JSON.parse(await invokeTool("nodeforge_read_file", { path: "src/index.ts" }));
    assert.match(read.content, /export function add/);
    const search = JSON.parse(await invokeTool("nodeforge_search_code", { query: "add" }));
    assert.ok(search.matches.length > 0);
  });

  test("source tools still refuse secrets in Restricted Mode", async () => {
    const result = JSON.parse(await invokeTool("nodeforge_read_file", { path: ".env" }));
    assert.strictEqual(result.ok, false);
  });

  test("nodeforge_apply_patch is refused and writes nothing in Restricted Mode", async () => {
    const target = path.join(workspaceRoot(), "src", "should-not-exist.ts");
    const text = await invokeTool("nodeforge_apply_patch", { edits: [{ path: "src/should-not-exist.ts", oldText: "", newText: "x" }] });
    assert.match(text, /disabled|not trusted/i);
    assert.strictEqual(fs.existsSync(target), false);
  });

  test("the @nodeforge participant refuses slash commands that need execution in Restricted Mode", async () => {
    const ext = await activateExtension();
    const model = { sendRequest: async () => { throw new Error("the model must not be called"); } };
    const result = await ext.exports.__testing.handleParticipantRequest(
      { prompt: "go", command: "diagnostics", model, references: [], toolInvocationToken: undefined },
      { history: [] },
      { markdown() {}, progress() {} },
      new vscode.CancellationTokenSource().token,
      vscode.workspace.isTrusted
    );
    assert.strictEqual(result.metadata.blocked, "untrusted");
  });
});
