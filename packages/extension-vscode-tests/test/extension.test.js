const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

const NODEFORGE_EXTENSION_ID = "nodeforge.nodeforge";
const REQUIRED_COMMANDS = [
  "nodeforge.analyzeWorkspace",
  "nodeforge.runDiagnostics",
  "nodeforge.runTests",
  "nodeforge.refreshGit",
  "nodeforge.auditDependencies"
];

suite("NodeForge extension host", () => {
  let extension;

  suiteSetup(async () => {
    extension = vscode.extensions.getExtension(NODEFORGE_EXTENSION_ID);
    assert.ok(extension, "NodeForge extension should be loaded by the extension host.");
    await extension.activate();
  });

  test("activates the NodeForge extension in a real extension host", () => {
    assert.equal(extension.isActive, true);
  });

  test("registers the core engineering commands contributed by the extension", async () => {
    const commands = await vscode.commands.getCommands(true);

    for (const command of REQUIRED_COMMANDS) {
      assert.ok(commands.includes(command), `Expected registered command: ${command}`);
    }
  });

  test("analyzes the real Node.js/TypeScript fixture through the extension command", async () => {
    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders && folders.length > 0, "The integration workspace should be open.");

    const workspaceRoot = folders[0].uri.fsPath;
    const expectedSuffix = path.join("packages", "test-fixtures", "node-ts-eslint");

    assert.ok(
      workspaceRoot.endsWith(expectedSuffix),
      `Expected workspace ending in ${expectedSuffix}, received ${workspaceRoot}`
    );

    assert.equal(
      fs.existsSync(path.join(workspaceRoot, "package.json")),
      true,
      "The fixture package.json should exist."
    );

    await vscode.commands.executeCommand("nodeforge.analyzeWorkspace");
  });
});
