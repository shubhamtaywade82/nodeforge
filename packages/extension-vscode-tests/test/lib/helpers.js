const assert = require("node:assert");
const vscode = require("vscode");

const EXTENSION_ID = "nodeforge.nodeforge";

async function activateExtension()                                     {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(ext, `extension ${EXTENSION_ID} not found`);
  if (!ext.isActive) await ext.activate();
  return ext;
}

function workspaceRoot()         {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "test workspace folder is not open");
  return folder.uri.fsPath;
}

async function waitFor   (
  probe                                              ,
  what        ,
  timeoutMs = 15000
)             {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function invokeTool(name        , input         = {})                  {
  const source = new vscode.CancellationTokenSource();
  try {
    const result = await vscode.lm.invokeTool(name, { input, toolInvocationToken: undefined }, source.token);
    return result.content
      .map((part) => (part instanceof vscode.LanguageModelTextPart ? part.value : ""))
      .join("");
  } finally {
    source.dispose();
  }
}

async function readReport(kind        , ext        )                               {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.from({ scheme: "nodeforge", path: `/${kind}.${ext}` }));
  return doc;
}

module.exports = { EXTENSION_ID, activateExtension, workspaceRoot, waitFor, invokeTool, readReport };
