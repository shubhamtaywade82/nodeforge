import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const extensionRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packagePath = join(extensionRoot, "package.json");

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

test("VS Code AI contributions point at real files", async () => {
  const manifest = await readJson(packagePath);

  for (const contribution of manifest.contributes?.chatSkills ?? []) {
    assert.match(contribution.path, /\/SKILL\.md$/);
    const absolutePath = join(extensionRoot, contribution.path);
    await assert.doesNotReject(() => readFile(absolutePath, "utf8"));
  }

  for (const field of ["chatInstructions", "chatAgents", "chatPromptFiles"]) {
    for (const contribution of manifest.contributes?.[field] ?? []) {
      assert.match(contribution.path, /\.md$/);
      const absolutePath = join(extensionRoot, contribution.path);
      await assert.doesNotReject(() => readFile(absolutePath, "utf8"));
    }
  }
});

test("skill frontmatter names match their directories", async () => {
  const manifest = await readJson(packagePath);

  for (const contribution of manifest.contributes?.chatSkills ?? []) {
    const skillPath = join(extensionRoot, contribution.path);
    const contents = await readFile(skillPath, "utf8");
    const name = contents.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const directory = dirname(contribution.path).split(/[\\/]/).pop();

    assert.ok(name, "Missing skill name in " + contribution.path);
    assert.equal(name, directory);
  }
});

test("language model tool contribution names are unique", async () => {
  const manifest = await readJson(packagePath);
  const names = (manifest.contributes?.languageModelTools ?? []).map(({ name }) => name);

  assert.ok(names.length > 0);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) {
    assert.match(name, /^nodeforge_[a-z0-9_]+$/);
  }
});
