const assert = require("node:assert");
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
});
