import { describe, expect, it } from "vitest";
import { classifyPackageScript, describeScriptRisk } from "../src/scriptRisk.js";

const classify = (script: string, scripts: Record<string, string>) => classifyPackageScript(script, scripts);

describe("classifyPackageScript", () => {
  it("rates plain verification and build scripts low", () => {
    expect(classify("test", { test: "vitest run" }).level).toBe("low");
    expect(classify("lint", { lint: "eslint . --max-warnings 0" }).level).toBe("low");
    expect(classify("typecheck", { typecheck: "tsc --noEmit" }).level).toBe("low");
    expect(classify("build", { build: "tsc -b" })).toMatchObject({ level: "low", categories: expect.arrayContaining(["build"]) });
  });

  it("rates dev servers and network use medium", () => {
    expect(classify("dev", { dev: "vite" }).level).toBe("medium");
    expect(classify("start", { start: "node server.js" }).level).toBe("medium");
    expect(classify("fetch", { fetch: "curl -s https://example.com/x.json -o x.json" }).level).toBe("medium");
  });

  it("rates deploys, publishes and infrastructure changes high", () => {
    for (const [name, command] of [
      ["deploy", "vercel deploy --prod"],
      ["release", "npm publish --access public"],
      ["ship", "docker push registry/app:latest"],
      ["infra", "terraform apply -auto-approve"],
      ["sync", "git push origin main"]
    ] as const) {
      const r = classify(name, { [name]: command });
      expect(r.level, name).toBe("high");
      expect(r.categories, name).toContain("external-effect");
    }
  });

  it("rates database changes high", () => {
    for (const command of ["prisma migrate deploy", "prisma db push", "drizzle-kit push", "knex migrate:latest", "psql -f reset.sql"]) {
      expect(classify("db", { db: command }).categories, command).toContain("mutates-data");
    }
  });

  it("rates file deletion and rewriting high", () => {
    for (const command of ["rm -rf dist", "rimraf build", "eslint . --fix", "prettier --write .", "git clean -fdx", "echo hi > out.txt"]) {
      expect(classify("x", { x: command }).level, command).toBe("high");
    }
  });

  it("does not treat stderr redirection or /dev/null as a file write", () => {
    expect(classify("x", { x: "vitest run 2>&1" }).level).toBe("low");
    expect(classify("x", { x: "vitest run > /dev/null" }).level).toBe("low");
  });

  it("lets a dangerous script name raise the level even when the command looks harmless", () => {
    expect(classify("deploy", { deploy: "node scripts/run.js" }).level).toBe("high");
    expect(classify("migrate", { migrate: "node migrate.js" }).categories).toContain("mutates-data");
  });

  it("follows scripts that call other scripts and reports where the risk comes from", () => {
    const r = classify("ci", { ci: "pnpm run lint && pnpm run release", lint: "eslint .", release: "npm publish" });
    expect(r.level).toBe("high");
    expect(r.reasons.some((x) => x.detail.includes('via "release"'))).toBe(true);
    expect(r.commands.map((c) => c.name)).toEqual(["ci", "lint", "release"]);
  });

  it("includes implicit pre/post hooks in what will run", () => {
    const r = classify("build", { prebuild: "rm -rf dist", build: "tsc", postbuild: "node copy.js" });
    expect(r.commands.map((c) => c.name)).toEqual(["prebuild", "build", "postbuild"]);
    expect(r.level).toBe("high");
  });

  it("marks hooks so the confirmation does not overstate when they run", () => {
    const r = classify("build", { prebuild: "rm -rf dist", build: "tsc" });
    expect(r.commands.map((c) => c.hook)).toEqual(["pre", undefined]);
    expect(describeScriptRisk(r, "pnpm")).toContain("pre hook");
  });

  it("terminates on cycles and caps depth", () => {
    const r = classify("a", { a: "npm run b", b: "npm run a" });
    expect(r.commands.map((c) => c.name)).toEqual(["a", "b"]);
  });

  it("flags unknown commands and undefined scripts as unknown (medium), never silently low", () => {
    expect(classify("weird", { weird: "./do-the-thing.sh" })).toMatchObject({ level: "medium", categories: ["unknown"] });
    expect(classify("nope", {})).toMatchObject({ level: "medium", categories: ["unknown"], commands: [] });
  });
});

describe("describeScriptRisk", () => {
  it("shows the command, the risk level and the reasons", () => {
    const text = describeScriptRisk(classify("deploy", { deploy: "vercel deploy --prod" }), "pnpm");
    expect(text).toContain("Run `pnpm run deploy`?");
    expect(text).toContain("**Risk: High.**");
    expect(text).toContain("`deploy`: `vercel deploy --prod`");
    expect(text).toContain("deploys to or changes a cloud service");
    expect(text).toContain("affect systems outside this workspace");
  });

  it("neutralizes backticks in commands and truncates very long ones", () => {
    const text = describeScriptRisk(classify("x", { x: `echo \`whoami\` ${"a".repeat(500)}` }), "npm");
    expect(text).not.toContain("`whoami`");
    expect(text).not.toContain("a".repeat(250));
  });
});
