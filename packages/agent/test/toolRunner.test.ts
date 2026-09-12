import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { executeTool, UnknownToolError } from "../src/toolRunner.js";
import { NodeForgeContext } from "../src/NodeForgeContext.js";

const FIXTURE = path.resolve(__dirname, "../../test-fixtures/node-ts-docker");

describe("executeTool", () => {
  it("runs getProjectContext", async () => {
    const ctx = new NodeForgeContext(FIXTURE);
    const text = await executeTool("getProjectContext", {}, ctx);
    const profile = JSON.parse(text) as { root: string };
    expect(profile.root).toBe(FIXTURE);
  });

  it("throws for unknown tools", async () => {
    const ctx = new NodeForgeContext(FIXTURE);
    await expect(executeTool("not_a_tool", {}, ctx)).rejects.toBeInstanceOf(UnknownToolError);
  });
});
