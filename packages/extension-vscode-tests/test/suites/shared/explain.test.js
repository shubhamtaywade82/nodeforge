const assert = require("node:assert");
const path = require("node:path");
const vscode = require("vscode");
const { activateExtension, workspaceRoot } = require("../../lib/helpers");

const token = () => new vscode.CancellationTokenSource().token;

suite("Explain with NodeForge", () => {
  let ext;
  suiteSetup(async () => {
    ext = await activateExtension();
  });

  test("/explain offers only read-only tools and the model is told to treat the excerpt as data", async () => {
    let options;
    let messages;
    const model = {
      sendRequest: async (m, o) => {
        messages = m;
        options = o;
        return { stream: (async function* () { yield new vscode.LanguageModelTextPart("explained"); })() };
      }
    };
    const result = await ext.exports.__testing.handleParticipantRequest(
      { prompt: "src/index.ts:1\nCode:\n```\nexport function add\n```", command: "explain", model, references: [], toolInvocationToken: undefined },
      { history: [] },
      { markdown() {}, progress() {} },
      token(),
      vscode.workspace.isTrusted
    );
    const offered = (options?.tools ?? []).map((t) => t.name).sort();
    assert.deepStrictEqual(offered, ["nodeforge_get_project_context", "nodeforge_read_file", "nodeforge_search_code"]);
    assert.notStrictEqual(result?.metadata?.blocked, "untrusted", "/explain is read-only and must work in Restricted Mode");
    const system = messages.map((m) => m.content.map((p) => p.value ?? "").join("")).join("\n");
    assert.match(system, /untrusted data/);
  });

  test("a diagnostic hover carries an Explain link that only enables the explain command", async () => {
    const uri = vscode.Uri.file(path.join(workspaceRoot(), "src", "index.ts"));
    await vscode.workspace.openTextDocument(uri);
    const collection = vscode.languages.createDiagnosticCollection("nodeforge-explain-test");
    try {
      const diag = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 6), "Unexpected `export` (test)", vscode.DiagnosticSeverity.Warning);
      diag.source = "eslint";
      diag.code = "no-test-rule";
      collection.set(uri, [diag]);
      const hovers = await vscode.commands.executeCommand("vscode.executeHoverProvider", uri, new vscode.Position(0, 2));
      const md = hovers.flatMap((h) => h.contents).filter((c) => c instanceof vscode.MarkdownString);
      const link = md.find((c) => c.value.includes("command:nodeforge.explainDiagnostic?"));
      assert.ok(link, "hover must contain the Explain with NodeForge link");
      assert.deepStrictEqual(link.isTrusted, { enabledCommands: ["nodeforge.explainDiagnostic"] });
      // Parentheses in the diagnostic text must not terminate the markdown link early.
      const href = /\(command:nodeforge\.explainDiagnostic\?([^)]*)\)/.exec(link.value);
      assert.ok(href, "link must be well-formed");
      const [args] = JSON.parse(decodeURIComponent(href[1]));
      assert.strictEqual(args.message, "Unexpected `export` (test)");
      assert.strictEqual(args.line, 1);
    } finally {
      collection.dispose();
    }
  });

  test("explainDiagnostic ignores invalid arguments and files outside the workspace", async () => {
    await vscode.commands.executeCommand("nodeforge.explainDiagnostic", { file: 5 });
    await vscode.commands.executeCommand("nodeforge.explainDiagnostic", { file: "/etc/passwd", line: 1 });
  });
});
