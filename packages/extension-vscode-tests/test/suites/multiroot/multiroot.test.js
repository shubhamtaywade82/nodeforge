const assert = require("node:assert");
const path = require("node:path");
const vscode = require("vscode");
const { activateExtension, invokeTool } = require("../../lib/helpers");

suite("Multi-root workspace (trusted)", () => {
  let hooks;
  const folderPath = (name) => {
    const f = vscode.workspace.workspaceFolders.find((x) => x.name === name);
    assert.ok(f, `folder ${name} is open`);
    return f.uri.fsPath;
  };
  const marker = async () => JSON.parse(await invokeTool("nodeforge_read_file", { path: "marker.txt" })).content.trim();

  suiteSetup(async () => {
    const ext = await activateExtension();
    hooks = ext.exports.__testing;
  });

  test("opens as a three-folder workspace", () => {
    assert.deepStrictEqual(vscode.workspace.workspaceFolders.map((f) => f.name), ["a", "b", "c"]);
  });

  test("defaults to the first folder", async () => {
    assert.strictEqual(hooks.activeRoot(), folderPath("a"));
    assert.strictEqual(await marker(), "a");
  });

  test("selecting a folder retargets the agent tools", async () => {
    await vscode.commands.executeCommand("nodeforge.selectWorkspaceFolder", folderPath("b"));
    assert.strictEqual(hooks.activeRoot(), folderPath("b"));
    assert.strictEqual(await marker(), "b");
    await vscode.commands.executeCommand("nodeforge.selectWorkspaceFolder", folderPath("c"));
    assert.strictEqual(await marker(), "c");
  });

  test("tools cannot escape the active folder into a sibling folder", async () => {
    const result = JSON.parse(await invokeTool("nodeforge_read_file", { path: path.join("..", "a", "marker.txt") }));
    assert.strictEqual(result.ok, false);
  });

  test("a path that is not a workspace folder is rejected", async () => {
    await assert.rejects(() => vscode.commands.executeCommand("nodeforge.selectWorkspaceFolder", "/tmp/not-a-folder"));
    assert.strictEqual(await marker(), "c");
  });

  test("removing the active folder falls back to the first remaining folder", async () => {
    assert.strictEqual(hooks.activeRoot(), folderPath("c"));
    const changed = new Promise((resolve) => vscode.workspace.onDidChangeWorkspaceFolders(resolve));
    const index = vscode.workspace.workspaceFolders.findIndex((f) => f.name === "c");
    assert.ok(vscode.workspace.updateWorkspaceFolders(index, 1));
    await changed;
    assert.strictEqual(hooks.activeRoot(), folderPath("a"));
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(await marker(), "a");
  });
});
