import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeForgeContext } from "../src/NodeForgeContext.js";
import { authorizeTool, type ToolExecutionContext } from "../src/toolPolicy.js";
import { ToolArgumentValidationError, executeTool } from "../src/toolRunner.js";

let root: string;
let ctx: NodeForgeContext;

const policy = (over: Partial<ToolExecutionContext> = {}): ToolExecutionContext => ({
  caller: "vscode",
  workspaceTrusted: true,
  executionAllowed: true,
  writesAllowed: true,
  networkAllowed: false,
  approvalGranted: true,
  ...over
});

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "nf-tools-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "a.ts"), "export const a = 1;\n");
  await writeFile(path.join(root, ".env"), "TOKEN=abc\n");
  ctx = new NodeForgeContext(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("source tool policy", () => {
  it("readFile and searchCode are read-only and need neither trust nor execution", () => {
    for (const name of ["readFile", "searchCode"]) {
      const untrusted = policy({ workspaceTrusted: false, executionAllowed: false, writesAllowed: false, approvalGranted: false });
      expect(authorizeTool(name, untrusted).allowed, name).toBe(true);
    }
  });

  it("applyPatch requires trust, execution capability, write capability and approval", () => {
    expect(authorizeTool("applyPatch", policy()).allowed).toBe(true);
    expect(authorizeTool("applyPatch", policy({ workspaceTrusted: false })).code).toBe("WORKSPACE_NOT_TRUSTED");
    expect(authorizeTool("applyPatch", policy({ executionAllowed: false })).code).toBe("EXECUTION_DISABLED");
    expect(authorizeTool("applyPatch", policy({ writesAllowed: false })).code).toBe("WRITES_DISABLED");
    expect(authorizeTool("applyPatch", policy({ approvalGranted: false })).code).toBe("APPROVAL_REQUIRED");
  });

  it("MCP callers can never patch unless writes are explicitly enabled", () => {
    const mcp = policy({ caller: "mcp", writesAllowed: false, approvalGranted: false });
    expect(authorizeTool("applyPatch", mcp).code).toBe("WRITES_DISABLED");
    expect(authorizeTool("applyPatch", { ...mcp, writesAllowed: true }).allowed).toBe(true);
  });
});

describe("source tools through executeTool", () => {
  it("readFile returns file content as JSON and refuses secrets as data, not as an exception", async () => {
    const ok = JSON.parse(await executeTool("readFile", { path: "src/a.ts" }, ctx, policy())) as { content: string };
    expect(ok.content).toBe("export const a = 1;");
    const denied = JSON.parse(await executeTool("readFile", { path: ".env" }, ctx, policy())) as { ok: boolean; error: string };
    expect(denied).toMatchObject({ ok: false, error: "PATH_DENIED" });
  });

  it("searchCode finds matches", async () => {
    const r = JSON.parse(await executeTool("searchCode", { query: "const a" }, ctx, policy())) as { matches: Array<{ path: string; line: number }> };
    expect(r.matches).toEqual([{ path: "src/a.ts", line: 1, text: "export const a = 1;" }]);
  });

  it("applyPatch edits files and reports failures as data", async () => {
    const ok = JSON.parse(
      await executeTool("applyPatch", { edits: [{ path: "src/a.ts", oldText: "a = 1", newText: "a = 2" }] }, ctx, policy())
    ) as { ok: boolean };
    expect(ok.ok).toBe(true);
    expect(await readFile(path.join(root, "src", "a.ts"), "utf8")).toBe("export const a = 2;\n");

    const bad = JSON.parse(
      await executeTool("applyPatch", { edits: [{ path: "src/a.ts", oldText: "missing", newText: "x" }] }, ctx, policy())
    ) as { ok: boolean; error: string; message: string };
    expect(bad).toMatchObject({ ok: false, error: "EDIT_FAILED" });
    expect(bad.message).toMatch(/not found/);
  });

  it("applyPatch is refused before touching disk when the policy denies it", async () => {
    await expect(
      executeTool("applyPatch", { edits: [{ path: "src/a.ts", oldText: "a = 1", newText: "a = 2" }] }, ctx, policy({ approvalGranted: false }))
    ).rejects.toThrow(/approval/i);
    expect(await readFile(path.join(root, "src", "a.ts"), "utf8")).toBe("export const a = 1;\n");
  });

  it("rejects unknown arguments and wrong types at the validation layer", async () => {
    await expect(executeTool("readFile", { path: "src/a.ts", extra: 1 }, ctx, policy())).rejects.toBeInstanceOf(ToolArgumentValidationError);
    await expect(executeTool("readFile", {}, ctx, policy())).rejects.toBeInstanceOf(ToolArgumentValidationError);
    await expect(executeTool("searchCode", { query: 5 }, ctx, policy())).rejects.toBeInstanceOf(ToolArgumentValidationError);
    await expect(executeTool("applyPatch", { edits: "nope" }, ctx, policy())).rejects.toBeInstanceOf(ToolArgumentValidationError);
  });
});
