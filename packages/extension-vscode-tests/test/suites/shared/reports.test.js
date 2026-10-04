const assert = require("node:assert");
const vscode = require("vscode");
const { activateExtension, waitFor, workspaceRoot } = require("../../lib/helpers");

suite("Virtual report documents", () => {
  suiteSetup(async () => {
    await activateExtension();
  });

  test("the profile report is valid JSON describing the fixture", async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.from({ scheme: "nodeforge", path: "/profile.json" }));
    const profile = JSON.parse(doc.getText())                                                                 ;
    assert.strictEqual(profile.root, workspaceRoot());
    assert.strictEqual(profile.typescript, true);
    assert.strictEqual(profile.packageManager, "npm");
  });

  test("unknown report paths render an explanatory document, not an error", async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.from({ scheme: "nodeforge", path: "/nope.json" }));
    assert.match(doc.getText(), /Unknown NodeForge report/);
  });

  test("NodeForge: Open Report opens the requested report in an editor with the right language", async () => {
    await vscode.commands.executeCommand("nodeforge.openReport", "profile");
    const editor = await waitFor(
      () => vscode.window.visibleTextEditors.find((e) => e.document.uri.scheme === "nodeforge"),
      "the report editor"
    );
    assert.strictEqual(editor.document.uri.path, "/profile.json");
    assert.strictEqual(editor.document.languageId, "json");
  });
});
