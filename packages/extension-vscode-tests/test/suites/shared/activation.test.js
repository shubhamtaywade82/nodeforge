const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");
const { activateExtension } = require("../../lib/helpers");

suite("Activation and contributions", () => {
  test("the extension activates without errors", async () => {
    const ext = await activateExtension();
    assert.strictEqual(ext.isActive, true);
  });

  test("every contributed command is registered", async () => {
    const ext = await activateExtension();
    const contributed = (ext.packageJSON                                                             ).contributes.commands.map(
      (c) => c.command
    );
    const registered = new Set(await vscode.commands.getCommands(true));
    const missing = contributed.filter((c) => !registered.has(c));
    assert.deepStrictEqual(missing, []);
  });

  test("every contributed language-model tool is registered and the participant list matches", async () => {
    const ext = await activateExtension();
    const manifest = ext.packageJSON                                                                    ;
    const live = new Set(vscode.lm.tools.map((t) => t.name));
    const missing = manifest.contributes.languageModelTools.map((t) => t.name).filter((n) => !live.has(n));
    assert.deepStrictEqual(missing, []);
  });

  test("bundled MCP server exists next to the extension bundle", async () => {
    const ext = await activateExtension();
    assert.ok(fs.existsSync(path.join(ext.extensionPath, "dist", "mcp.cjs")), "dist/mcp.cjs missing");
  });
});
