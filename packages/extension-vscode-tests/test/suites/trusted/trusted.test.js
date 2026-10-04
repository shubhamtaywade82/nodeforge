const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");
const { activateExtension, invokeTool, waitFor, workspaceRoot } = require("../../lib/helpers");

/** Reads a file or returns undefined if it does not exist yet (no exists-then-read window). */
function readIfPresent(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return undefined;
    throw err;
  }
}

suite("Trusted workspace", () => {
  suiteSetup(async () => {
    await activateExtension();
  });

  test("the workspace is trusted", () => {
    assert.strictEqual(vscode.workspace.isTrusted, true);
  });

  test("nodeforge_get_project_context returns the fixture profile", async () => {
    const profile = JSON.parse(await invokeTool("nodeforge_get_project_context"));
    assert.strictEqual(profile.root, workspaceRoot());
    assert.strictEqual(profile.typescript, true);
    assert.strictEqual(profile.testRunner, "vitest");
  });

  test("the git-diff tool runs in a trusted workspace and returns a diff object, not a refusal", async () => {
    const result = JSON.parse(await invokeTool("nodeforge_get_git_diff", { scope: "working" }));
    assert.strictEqual(result.error, undefined, `tool refused: ${JSON.stringify(result)}`);
    assert.strictEqual(result.scope, "working");
    assert.ok(Array.isArray(result.files));
  });

  test("the NodeForge terminal profile is offered as an extension profile and opens as 'NodeForge'", async () => {
    // `newWithProfile` only knows detected shells, so select the contributed profile as the default.
    const platformKey = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "osx" : "linux";
    const config = vscode.workspace.getConfiguration("terminal.integrated.defaultProfile");
    await config.update(platformKey, "NodeForge", vscode.ConfigurationTarget.Global);
    try {
      const opened = new Promise                 ((resolve) => {
        const sub = vscode.window.onDidOpenTerminal((t) => {
          if (t.name === "NodeForge") {
            sub.dispose();
            resolve(t);
          }
        });
      });
      await vscode.commands.executeCommand("workbench.action.terminal.new");
      const terminal = await Promise.race([
        opened,
        new Promise       ((_, reject) => setTimeout(() => reject(new Error("terminal did not open")), 15000))
      ]);
      assert.strictEqual(terminal.name, "NodeForge");
      terminal.dispose();
    } finally {
      await config.update(platformKey, undefined, vscode.ConfigurationTarget.Global);
    }
  });

  async function debugWithDotenv() {
    const out = path.join(workspaceRoot(), "out.txt");
    const dotenv = path.join(workspaceRoot(), ".env");
    fs.rmSync(out, { force: true });
    fs.writeFileSync(dotenv, "NF_FIXTURE_VAR=from-dotenv\n");
    const folder = vscode.workspace.workspaceFolders?.[0];
    const started = await vscode.debug.startDebugging(folder, {
      type: "node",
      request: "launch",
      name: "nodeforge-integration",
      program: path.join(workspaceRoot(), "src", "debug-target.js"),
      cwd: workspaceRoot(),
      console: "internalConsole",
      env: { NF_OUT: out }
    });
    try {
      assert.strictEqual(started, true, "debug session did not start");
      return await waitFor(() => readIfPresent(out), "debuggee output", 30000);
    } finally {
      fs.rmSync(out, { force: true });
      fs.rmSync(dotenv, { force: true });
    }
  }

  test("F5 debug sessions do NOT read .env unless nodeforge.debug.loadDotEnv is enabled", async () => {
    const config = vscode.workspace.getConfiguration("nodeforge.debug");
    assert.strictEqual(config.get("loadDotEnv"), false);
    assert.strictEqual(await debugWithDotenv(), "missing");
  });

  test("F5 debug sessions get .env values injected when nodeforge.debug.loadDotEnv is enabled", async () => {
    const config = vscode.workspace.getConfiguration("nodeforge.debug");
    await config.update("loadDotEnv", true, vscode.ConfigurationTarget.Global);
    try {
      assert.strictEqual(await debugWithDotenv(), "from-dotenv");
    } finally {
      await config.update("loadDotEnv", undefined, vscode.ConfigurationTarget.Global);
    }
  });
});
