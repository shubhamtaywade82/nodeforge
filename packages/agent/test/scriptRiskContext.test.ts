import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeForgeContext } from "../src/NodeForgeContext.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "nf-risk-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("NodeForgeContext.getScriptRisk", () => {
  it("classifies a script from the workspace package.json and reports the package manager", async () => {
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { predeploy: "npm run build", build: "tsc", deploy: "vercel deploy --prod" } })
    );
    await writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    const { risk, packageManager } = await new NodeForgeContext(root).getScriptRisk("deploy");
    expect(packageManager).toBe("pnpm");
    expect(risk.level).toBe("high");
    expect(risk.commands.map((c) => c.name)).toEqual(["predeploy", "build", "deploy"]);
  });

  it("reports an undefined script as unknown instead of throwing", async () => {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
    const { risk } = await new NodeForgeContext(root).getScriptRisk("missing");
    expect(risk).toMatchObject({ level: "medium", categories: ["unknown"] });
  });

  it("survives a missing or malformed package.json", async () => {
    expect((await new NodeForgeContext(root).getScriptRisk("x")).risk.categories).toEqual(["unknown"]);
    await writeFile(path.join(root, "package.json"), "{ not json");
    expect((await new NodeForgeContext(root).getScriptRisk("x")).risk.categories).toEqual(["unknown"]);
  });

  it("ignores non-string script values", async () => {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { a: 5, b: "vitest" } }));
    expect((await new NodeForgeContext(root).getScriptRisk("b")).risk.level).toBe("low");
  });
});
