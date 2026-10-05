import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PARTICIPANT_COMMANDS,
  buildSystemPrompt,
  clampToolRounds,
  commandAllowedInRestrictedMode,
  findParticipantCommand,
  selectTools
} from "../src/ai/participantCommands.ts";

const tools = [
  { name: "nodeforge_get_project_context" },
  { name: "nodeforge_get_diagnostics" },
  { name: "nodeforge_run_typecheck" },
  { name: "nodeforge_run_script" },
  { name: "other_ext_tool" }
];
const names = (list: Array<{ name: string }>): string[] => list.map((t) => t.name);

describe("participant commands", () => {
  it("has unique command names", () => {
    const all = PARTICIPANT_COMMANDS.map((c) => c.name);
    assert.equal(new Set(all).size, all.length);
  });

  it("finds commands and returns undefined for unknown ones", () => {
    assert.equal(findParticipantCommand("tests")?.name, "tests");
    assert.equal(findParticipantCommand("nope"), undefined);
    assert.equal(findParticipantCommand(undefined), undefined);
  });

  it("never exposes non-NodeForge tools", () => {
    const out = names(selectTools(tools, undefined, true));
    assert.ok(!out.includes("other_ext_tool"));
    assert.ok(out.includes("nodeforge_run_script"));
  });

  it("narrows to the slash command's tools", () => {
    assert.deepEqual(names(selectTools(tools, findParticipantCommand("diagnostics"), true)), [
      "nodeforge_get_diagnostics",
      "nodeforge_run_typecheck"
    ]);
  });

  it("restricts to read-only inspection in Restricted Mode", () => {
    assert.deepEqual(names(selectTools(tools, undefined, false)), ["nodeforge_get_project_context"]);
    assert.deepEqual(selectTools(tools, findParticipantCommand("diagnostics"), false), []);
  });

  it("clamps tool rounds", () => {
    assert.equal(clampToolRounds(0), 1);
    assert.equal(clampToolRounds(99), 24);
    assert.equal(clampToolRounds(Number.NaN), 8);
    assert.equal(clampToolRounds("x"), 8);
    assert.equal(clampToolRounds(5.9), 5);
  });

  it("mentions Restricted Mode in the prompt only when untrusted", () => {
    assert.match(buildSystemPrompt(undefined, false), /Restricted Mode/);
    assert.doesNotMatch(buildSystemPrompt(undefined, true), /Restricted Mode/);
  });
});

describe("Restricted Mode routing", () => {
  const allowed = (name: string): boolean => {
    const cmd = findParticipantCommand(name);
    assert.ok(cmd, name);
    return commandAllowedInRestrictedMode(cmd);
  };
  it("allows only commands whose tools are all read-only", () => {
    assert.deepEqual(
      PARTICIPANT_COMMANDS.filter((c) => commandAllowedInRestrictedMode(c)).map((c) => c.name).sort(),
      ["context", "explain"]
    );
  });
  it("blocks anything that can execute or write", () => {
    for (const name of ["diagnostics", "tests", "fix", "addtests", "validate", "deps", "git", "db"]) {
      assert.equal(allowed(name), false, name);
    }
  });
});
