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

test("Ollama language model provider is declared exactly once", async () => {
  const manifest = await readJson(packagePath);
  const providers = manifest.contributes?.languageModelChatProviders ?? [];
  const matches = providers.filter(({ vendor }) => vendor === "nodeforge-ollama");

  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.displayName, "NodeForge Ollama");
});

test("restrictedConfigurations guards AI provider URLs and credentials", async () => {
  const manifest = await readJson(packagePath);
  const restricted = manifest.capabilities?.untrustedWorkspaces?.restrictedConfigurations ?? [];

  assert.ok(restricted.includes("nodeforge.chat.baseUrl"));
  assert.ok(restricted.includes("nodeforge.ollama.baseUrl"));
  assert.ok(restricted.includes("nodeforge.ai.provider"));
  assert.ok(restricted.includes("nodeforge.ai.anthropic.baseUrl"));
  assert.ok(restricted.includes("nodeforge.ai.anthropic.apiKey"));
  assert.ok(restricted.includes("nodeforge.ai.openai.baseUrl"));
  assert.ok(restricted.includes("nodeforge.ai.openai.apiKey"));
  assert.ok(restricted.includes("nodeforge.ai.ollama.baseUrl"));
  assert.ok(restricted.includes("nodeforge.ai.ollama.apiKey"));
});

test("AI configuration properties have valid schemas and defaults", async () => {
  const manifest = await readJson(packagePath);
  const props = manifest.contributes?.configuration?.properties ?? {};

  assert.equal(props["nodeforge.ai.provider"]?.default, "openai");
  assert.deepEqual(props["nodeforge.ai.provider"]?.enum, ["openai", "anthropic", "ollama"]);
  assert.equal(props["nodeforge.ai.anthropic.baseUrl"]?.default, "https://api.anthropic.com");
  assert.equal(props["nodeforge.ai.anthropic.model"]?.default, "claude-sonnet-4-5");
  assert.equal(props["nodeforge.ai.openai.baseUrl"]?.default, "https://api.openai.com/v1");
  assert.equal(props["nodeforge.ai.openai.model"]?.default, "gpt-4o-mini");
  assert.equal(props["nodeforge.ai.ollama.baseUrl"]?.default, "http://localhost:11434");
});
