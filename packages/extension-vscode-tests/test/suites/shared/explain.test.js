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

  test("openOfflineDoc validates its arguments and never opens a panel for traversal or unsynced docs", async () => {
    const tabs = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).length;
    const before = tabs();
    for (const arg of [undefined, { slug: "../x", htmlFile: "a.html" }, { slug: "node", htmlFile: "../../etc/passwd.html" }, { slug: "node", htmlFile: "missing.html" }]) {
      await vscode.commands.executeCommand("nodeforge.openOfflineDoc", arg);
    }
    assert.strictEqual(tabs(), before);
  });

  suite("commands as the user triggers them (chat hand-off captured)", () => {
    let queries;
    const uriOf = () => vscode.Uri.file(path.join(workspaceRoot(), "src", "index.ts"));

    setup(() => {
      queries = [];
      ext.exports.__testing.setChatOpener(async (q) => { queries.push(q); });
    });
    teardown(() => {
      ext.exports.__testing.setChatOpener(undefined);
      ext.exports.__testing.diagnosticStore.clearAll();
    });

    test("the Explain Quick Fix is offered for a NodeForge diagnostic and hands a grounded query to chat", async () => {
      const store = ext.exports.__testing.diagnosticStore;
      store.publish("eslint", [{
        id: "t1", source: "eslint", severity: "warning", message: "Unexpected thing (test)", file: uriOf().fsPath,
        range: { line: 1, column: 1, endLine: 1, endColumn: 7 }, rule: "no-test-rule", fixable: false
      }]);
      await vscode.workspace.openTextDocument(uriOf());
      const actions = await vscode.commands.executeCommand("vscode.executeCodeActionProvider", uriOf(), new vscode.Range(0, 0, 0, 3));
      const explain = actions.find((a) => a.title.startsWith("Explain with NodeForge"));
      assert.ok(explain, `no Explain action among: ${actions.map((a) => a.title).join(" | ")}`);
      assert.match(explain.title, /no-test-rule/);
      assert.strictEqual(explain.command.command, "nodeforge.explainDiagnostic");

      await vscode.commands.executeCommand(explain.command.command, ...explain.command.arguments);
      assert.strictEqual(queries.length, 1);
      const q = queries[0];
      assert.ok(q.startsWith("@nodeforge /explain src/index.ts:1:1\n"), q);
      assert.match(q, /Finding: warning · eslint · no-test-rule/);
      assert.match(q, /Message: Unexpected thing \(test\)/);
      assert.match(q, /export function add/, "the excerpt comes from the real file");
    });

    test("the editor command explains the current selection, or the current line when nothing is selected", async () => {
      const doc = await vscode.workspace.openTextDocument(uriOf());
      const editor = await vscode.window.showTextDocument(doc);
      editor.selection = new vscode.Selection(0, 0, 0, 6);
      await vscode.commands.executeCommand("nodeforge.explainSelection");
      assert.match(queries[0], /^@nodeforge \/explain src\/index\.ts:1:1\nCode:\n```\nexport\n```$/);

      editor.selection = new vscode.Selection(0, 3, 0, 3);
      await vscode.commands.executeCommand("nodeforge.explainSelection");
      assert.match(queries[1], /export function add/);
    });

    test("the editor submenu contributes the explain command and the hand-off query routes to /explain", async () => {
      const manifest = require(path.join(__dirname, "..", "..", "..", "..", "extension", "package.json"));
      const items = manifest.contributes.menus["nodeforge.editorSubmenu"].map((i) => i.command);
      assert.ok(items.includes("nodeforge.explainSelection"));

      // The captured query drives the real participant: same command routing and tool set.
      const doc = await vscode.workspace.openTextDocument(uriOf());
      const editor = await vscode.window.showTextDocument(doc);
      editor.selection = new vscode.Selection(0, 0, 0, 6);
      await vscode.commands.executeCommand("nodeforge.explainSelection");
      const prompt = queries[0].replace(/^@nodeforge \/explain /, "");
      let sentTools;
      const model = {
        sendRequest: async (_m, o) => {
          sentTools = (o?.tools ?? []).map((t) => t.name).sort();
          return { stream: (async function* () { yield new vscode.LanguageModelTextPart("ok"); })() };
        }
      };
      await ext.exports.__testing.handleParticipantRequest(
        { prompt, command: "explain", model, references: [], toolInvocationToken: undefined },
        { history: [] }, { markdown() {}, progress() {} }, token(), vscode.workspace.isTrusted
      );
      assert.deepStrictEqual(sentTools, ["nodeforge_get_project_context", "nodeforge_read_file", "nodeforge_search_code"]);
    });
  });
});
