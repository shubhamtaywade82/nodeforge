/**
 * Keeps the agent tool surface, the VS Code language-model tools, the custom agent's tool list
 * and the chat participant's routing consistent with one another.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PARTICIPANT_COMMANDS, RESTRICTED_MODE_TOOLS } from "../src/ai/participantCommands.ts";

const root = join(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  contributes: { languageModelTools: Array<{ name: string; toolReferenceName: string; tags?: string[] }> };
};
const lmTools = manifest.contributes.languageModelTools;
const lmNames = new Set(lmTools.map((t) => t.name));

const agentToolNames = new Set(
  [...readFileSync(join(root, "..", "agent", "src", "tools.ts"), "utf8").matchAll(/name: "([A-Za-z]+)"/g)].map((m) => m[1] as string)
);
const registeredMappings = [...readFileSync(join(root, "src", "ai", "LanguageModelTools.ts"), "utf8").matchAll(
  /register<[\s\S]*?>\("(nodeforge_[a-z_]+)", \{\s*toolName: "([A-Za-z]+)"/g
)].map((m) => ({ lm: m[1] as string, agent: m[2] as string }));

describe("language-model tools ↔ agent tools", () => {
  it("every registered LM tool is contributed, and every contributed one is registered", () => {
    assert.deepEqual(new Set(registeredMappings.map((m) => m.lm)), lmNames);
  });

  it("every LM tool maps to an existing agent tool", () => {
    for (const m of registeredMappings) assert.ok(agentToolNames.has(m.agent), `${m.lm} → ${m.agent}`);
  });

  it("tool reference names are unique", () => {
    const refs = lmTools.map((t) => t.toolReferenceName);
    assert.equal(new Set(refs).size, refs.length);
  });

  it("tools tagged write or execute say so, and confirm (so the host prompts)", () => {
    for (const t of lmTools) {
      if (t.tags?.includes("write") || t.tags?.includes("execute")) {
        assert.ok(t.tags.includes("confirmation") || t.name === "nodeforge_validate_workspace", `${t.name} should carry the confirmation tag`);
      }
    }
  });
});

describe("custom agent and prompt files", () => {
  const files = [
    ...readdirSync(join(root, "agents")).map((f) => join(root, "agents", f)),
    ...readdirSync(join(root, "prompts")).map((f) => join(root, "prompts", f)),
    ...readdirSync(join(root, "instructions")).map((f) => join(root, "instructions", f))
  ];

  it("reference only contributed tools", () => {
    for (const file of files) {
      for (const [token] of readFileSync(file, "utf8").matchAll(/nodeforge_[a-z_]+/g)) {
        assert.ok(lmNames.has(token), `${file} references unknown tool ${token}`);
      }
    }
  });

  it("the NodeForge Engineer agent can read, search and patch source (not just analyze it)", () => {
    const agent = readFileSync(join(root, "agents", "nodeforge-engineer.agent.md"), "utf8");
    for (const tool of ["nodeforge_read_file", "nodeforge_search_code", "nodeforge_apply_patch"]) {
      assert.ok(agent.includes(`- ${tool}`), `agent tools list is missing ${tool}`);
    }
  });
});

describe("chat participant routing", () => {
  it("routes only to contributed tools", () => {
    for (const c of PARTICIPANT_COMMANDS) for (const t of c.toolNames) assert.ok(lmNames.has(t), `${c.name} → ${t}`);
  });

  it("commands that tell the model to edit also offer the edit tool, and read-only commands never do", () => {
    const editing = new Set(["fix", "addtests"]);
    for (const c of PARTICIPANT_COMMANDS) {
      assert.equal(c.toolNames.includes("nodeforge_apply_patch"), editing.has(c.name), c.name);
    }
  });

  it("Restricted Mode only ever allows read-only tools", () => {
    for (const name of RESTRICTED_MODE_TOOLS) {
      const tags = lmTools.find((t) => t.name === name)?.tags ?? [];
      assert.ok(tags.includes("read-only"), `${name} must be tagged read-only`);
    }
  });
});
