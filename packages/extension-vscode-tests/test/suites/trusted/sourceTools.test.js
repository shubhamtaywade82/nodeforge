const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { activateExtension, invokeTool, workspaceRoot } = require("../../lib/helpers");

suite("Source tools (trusted workspace)", () => {
  const created = [];

  suiteSetup(async () => {
    await activateExtension();
  });

  suiteTeardown(() => {
    for (const file of created) fs.rmSync(file, { force: true });
    fs.rmSync(path.join(workspaceRoot(), "src", "generated"), { recursive: true, force: true });
  });

  test("nodeforge_read_file returns file content with line metadata", async () => {
    const result = JSON.parse(await invokeTool("nodeforge_read_file", { path: "src/index.ts" }));
    assert.strictEqual(result.path, "src/index.ts");
    assert.match(result.content, /export function add/);
    assert.ok(result.totalLines >= 1);
  });

  test("nodeforge_search_code finds text with path and line", async () => {
    const result = JSON.parse(await invokeTool("nodeforge_search_code", { query: "export function add" }));
    assert.ok(result.matches.some((m) => m.path === "src/index.ts" && m.line === 1));
  });

  test("secrets, traversal and VCS paths are refused as data", async () => {
    for (const p of [".env", "../outside.txt", ".git/config", "node_modules/x/index.js"]) {
      const result = JSON.parse(await invokeTool("nodeforge_read_file", { path: p }));
      assert.strictEqual(result.ok, false, `${p} should be refused`);
    }
  });

  test("nodeforge_apply_patch creates, edits and reports failures without touching disk", async () => {
    const target = path.join(workspaceRoot(), "src", "generated", "made-by-tool.ts");
    created.push(target);

    const create = JSON.parse(
      await invokeTool("nodeforge_apply_patch", { edits: [{ path: "src/generated/made-by-tool.ts", oldText: "", newText: "export const v = 1;\n" }] })
    );
    assert.strictEqual(create.ok, true, JSON.stringify(create));
    assert.strictEqual(fs.readFileSync(target, "utf8"), "export const v = 1;\n");

    const edit = JSON.parse(
      await invokeTool("nodeforge_apply_patch", { edits: [{ path: "src/generated/made-by-tool.ts", oldText: "v = 1", newText: "v = 2" }] })
    );
    assert.strictEqual(edit.ok, true);
    assert.strictEqual(fs.readFileSync(target, "utf8"), "export const v = 2;\n");

    const bad = JSON.parse(
      await invokeTool("nodeforge_apply_patch", { edits: [{ path: "src/generated/made-by-tool.ts", oldText: "not there", newText: "x" }] })
    );
    assert.strictEqual(bad.ok, false);
    assert.strictEqual(fs.readFileSync(target, "utf8"), "export const v = 2;\n");
  });

  test("nodeforge_apply_patch refuses paths outside the workspace and secrets", async () => {
    const outside = path.join(path.dirname(workspaceRoot()), "escaped-by-nodeforge.txt");
    for (const p of ["../escaped-by-nodeforge.txt", ".env"]) {
      const result = JSON.parse(await invokeTool("nodeforge_apply_patch", { edits: [{ path: p, oldText: "", newText: "x" }] }));
      assert.strictEqual(result.ok, false, `${p} must be refused`);
    }
    assert.strictEqual(fs.existsSync(outside), false);
  });
});
