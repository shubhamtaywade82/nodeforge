/**
 * Guards the contract between package.json contributions and the code that implements them.
 * A contribution without an implementation (or the reverse) is a silent runtime failure in VS Code.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PARTICIPANT_COMMANDS } from "../src/ai/participantCommands.ts";

const root = join(import.meta.dirname, "..");
const c = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { contributes: Record<string, unknown> }).contributes;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith(".ts") ? [readFileSync(p, "utf8")] : [];
  });
}
const code = sources(join(root, "src")).join("\n");
const list = <T>(v: unknown): T[] => (v as T[] | undefined) ?? [];

describe("manifest ↔ implementation", () => {
  it("implements every contributed command and contributes every registered one", () => {
    const contributed = new Set(list<{ command: string }>(c["commands"]).map((x) => x.command));
    const registered = new Set([...code.matchAll(/registerCommand\(\s*"([^"]+)"/g)].map((m) => m[1] as string));
    assert.deepEqual([...contributed].filter((x) => !registered.has(x)), []);
    // nodeforge.openDiagnostic is internal and only opened programmatically.
    assert.deepEqual([...registered].filter((x) => !contributed.has(x) && x !== "nodeforge.openDiagnostic"), []);
  });

  it("registers the contributed participant, MCP provider and terminal profile", () => {
    const [participant] = list<{ id: string }>(c["chatParticipants"]);
    assert.ok(code.includes(`CHAT_PARTICIPANT_ID = "${participant?.id}"`));
    const [mcp] = list<{ id: string }>(c["mcpServerDefinitionProviders"]);
    assert.ok(code.includes(`MCP_PROVIDER_ID = "${mcp?.id}"`));
    const [profile] = list<{ id: string }>((c["terminal"] as { profiles: unknown }).profiles);
    assert.ok(code.includes(`registerTerminalProfileProvider("${profile?.id}"`));
  });

  it("keeps participant slash commands in sync with the router", () => {
    const contributed = list<{ commands: Array<{ name: string }> }>(c["chatParticipants"])[0]?.commands.map((x) => x.name) ?? [];
    assert.deepEqual([...contributed].sort(), PARTICIPANT_COMMANDS.map((x) => x.name).sort());
  });

  it("only routes participant commands to contributed language-model tools", () => {
    const tools = new Set(list<{ name: string }>(c["languageModelTools"]).map((x) => x.name));
    for (const cmd of PARTICIPANT_COMMANDS) for (const t of cmd.toolNames) assert.ok(tools.has(t), `${cmd.name} → ${t}`);
  });

  it("references only contributed commands, submenus and views from menus, keybindings and welcome content", () => {
    const commands = new Set(list<{ command: string }>(c["commands"]).map((x) => x.command));
    const known = (id: string): boolean => commands.has(id) || id.startsWith("workbench.");
    const menus = c["menus"] as Record<string, Array<{ command?: string; submenu?: string }>>;
    const submenus = new Set(list<{ id: string }>(c["submenus"]).map((x) => x.id));
    for (const [menu, items] of Object.entries(menus)) {
      for (const item of items) {
        if (item.command) assert.ok(known(item.command), `${menu}: ${item.command}`);
        if (item.submenu) assert.ok(submenus.has(item.submenu), `${menu}: ${item.submenu}`);
      }
    }
    for (const id of submenus) assert.ok(menus[id], `submenu ${id} has items`);
    for (const kb of list<{ command: string }>(c["keybindings"])) assert.ok(commands.has(kb.command), kb.command);

    const views = new Set(Object.values(c["views"] as Record<string, Array<{ id: string }>>).flatMap((v) => v.map((x) => x.id)));
    for (const w of list<{ view: string; contents: string }>(c["viewsWelcome"])) {
      assert.ok(views.has(w.view), w.view);
      for (const m of w.contents.matchAll(/\(command:([^)]+)\)/g)) assert.ok(known(m[1] as string), m[1]);
    }
  });
});
