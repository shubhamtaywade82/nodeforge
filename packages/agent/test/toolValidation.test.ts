import { describe, expect, it } from "vitest";
import { validateToolArguments } from "../src/toolRunner.js";

describe("validateToolArguments", () => {
  it("rejects unknown arguments", () => {
    expect(() =>
      validateToolArguments("getProjectContext", { unexpected: true })
    ).toThrow(/unexpected argument/i);
  });

  it("rejects an invalid enum value", () => {
    expect(() =>
      validateToolArguments("getGitDiff", { scope: "invalid" })
    ).toThrow(/scope/i);
  });

  it("rejects a missing required script name", () => {
    expect(() => validateToolArguments("runScript", {})).toThrow(/script/i);
  });

  it("rejects non-string script arguments", () => {
    expect(() =>
      validateToolArguments("runScript", { script: "test", args: [123] })
    ).toThrow(/args/i);
  });
});
