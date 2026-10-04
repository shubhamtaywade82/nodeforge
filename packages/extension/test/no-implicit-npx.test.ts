/** Debug and run paths must use project-local tools; `npx` can download and execute packages. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []
  );
}

describe("no implicit npx", () => {
  it("never spawns or configures npx / dlx in extension source", () => {
    // Comments may explain the rule; only executable code is checked.
    const stripComments = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const offenders = tsFiles(join(import.meta.dirname, "..", "src")).filter((f) =>
      /["'`](?:npx|pnpm dlx|yarn dlx)["'`]/.test(stripComments(readFileSync(f, "utf8")))
    );
    assert.deepEqual(offenders, []);
  });
});
