/**
 * Prompts must never promise a capability the tool surface cannot deliver.
 * Every tool a prompt names must exist, and a prompt that asks the model to read or change source
 * must name the tool that does it.
 */
import { describe, expect, it } from "vitest";
import { PROMPTS } from "../src/prompts.js";
import { NODEFORGE_SYSTEM_PROMPT } from "../src/systemPrompt.js";
import { TOOLS } from "../src/tools.js";

const TOOL_NAMES = new Set(TOOLS.map((t) => t.definition.name));

/** Tool names appear quoted ("name") in prompts; camelCase identifiers without spaces. */
function quotedToolLikeNames(text: string): string[] {
  return [...text.matchAll(/"([a-z]+[A-Z][A-Za-z]*|[a-z]+)"/g)].map((m) => m[1] as string);
}

const ACTION_VERBS = /^(get|run|apply|format|validate|read|search)[A-Z]/;

const CAPABILITY_CLAIMS: Array<{ claim: RegExp; tool: string; why: string }> = [
  { claim: /\bread (the )?(source )?(file|code)\b|\bsource file\b.*\bunderstand\b/i, tool: "readFile", why: "claims to read source" },
  { claim: /\b(fix|edit|modify|change|write|create)\b[^.\n]*\b(file|code|test|error)/i, tool: "applyPatch", why: "claims to change files" },
  { claim: /\bfind (the )?(existing )?(tests|callers|usages)\b|\blook at existing test/i, tool: "searchCode", why: "claims to search the codebase" }
];

describe("prompt ↔ tool contract", () => {
  for (const prompt of [...PROMPTS.map((p) => ({ name: p.name, text: p.message })), { name: "system prompt", text: NODEFORGE_SYSTEM_PROMPT }]) {
    it(`${prompt.name}: every tool it names exists`, () => {
      const named = quotedToolLikeNames(prompt.text).filter((n) => ACTION_VERBS.test(n));
      const unknown = named.filter((n) => !TOOL_NAMES.has(n));
      expect(unknown).toEqual([]);
    });
  }

  for (const prompt of PROMPTS) {
    it(`${prompt.name}: capability claims are backed by a named tool`, () => {
      for (const { claim, tool, why } of CAPABILITY_CLAIMS) {
        if (claim.test(prompt.message)) {
          expect(prompt.message, `${prompt.name} ${why} but never names "${tool}"`).toContain(`"${tool}"`);
        }
      }
    });
  }

  it("the system prompt names the source tools it tells the model to use", () => {
    for (const tool of ["readFile", "searchCode", "applyPatch"]) expect(NODEFORGE_SYSTEM_PROMPT).toContain(tool);
  });

  it("add-test-for and validate-and-fix can actually do what they describe", () => {
    const addTest = PROMPTS.find((p) => p.name === "add-test-for")?.message ?? "";
    for (const tool of ["getProjectContext", "readFile", "searchCode", "applyPatch", "getTestResults"]) {
      expect(addTest).toContain(`"${tool}"`);
    }
    expect(addTest).not.toMatch(/do NOT write the file/i);
    const fix = PROMPTS.find((p) => p.name === "validate-and-fix")?.message ?? "";
    for (const tool of ["validateWorkspace", "readFile", "applyPatch"]) expect(fix).toContain(`"${tool}"`);
  });
});
