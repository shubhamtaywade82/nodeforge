import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_READ_BYTES,
  SourceAccessDeniedError,
  applySourcePatch,
  denyReason,
  readSourceFile,
  searchSourceCode
} from "../src/sourceFiles.js";

let root: string;
let outside: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "nf-src-"));
  outside = await mkdtemp(path.join(tmpdir(), "nf-out-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "dep"), { recursive: true });
  await mkdir(path.join(root, ".git"), { recursive: true });
  await writeFile(path.join(root, "src", "a.ts"), "export const a = 1;\nexport function add(x: number) {\n  return x + 1;\n}\n");
  await writeFile(path.join(root, "src", "b.ts"), "import { a } from './a';\nconsole.log(a);\n");
  await writeFile(path.join(root, ".env"), "SECRET=1\n");
  await writeFile(path.join(root, "node_modules", "dep", "index.js"), "export const secretNeedle = 1;\n");
  await writeFile(path.join(root, ".git", "config"), "needle\n");
  await writeFile(path.join(outside, "outside.txt"), "outside\n");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (error) {
    if (error instanceof SourceAccessDeniedError) return error.code;
    throw error;
  }
  return "NO_ERROR";
};

describe("denyReason", () => {
  it("blocks secrets, VCS internals and dependency trees", () => {
    for (const p of [".env", ".env.local", "a/.env.production", ".npmrc", "keys/server.pem", "id_rsa", "node_modules/x/y.js", ".git/config", "a/b/credentials.json"]) {
      expect(denyReason(p), p).toBeTypeOf("string");
    }
    for (const p of ["src/env.ts", "src/environment.ts", "README.md", "src/keyboard.ts", "docs/git.md"]) {
      expect(denyReason(p), p).toBeUndefined();
    }
  });
});

describe("readSourceFile", () => {
  it("reads a whole file with line metadata", async () => {
    const r = await readSourceFile(root, "src/a.ts");
    expect(r).toMatchObject({ path: "src/a.ts", startLine: 1, endLine: 4, totalLines: 4, truncated: false });
    expect(r.content.startsWith("export const a")).toBe(true);
  });

  it("reads a line range", async () => {
    const r = await readSourceFile(root, "src/a.ts", { startLine: 2, endLine: 3 });
    expect(r.content).toBe("export function add(x: number) {\n  return x + 1;");
    expect([r.startLine, r.endLine]).toEqual([2, 3]);
  });

  it("clamps the range to the file and rejects inverted ranges", async () => {
    expect((await readSourceFile(root, "src/a.ts", { startLine: 3, endLine: 99 })).endLine).toBe(4);
    expect(await code(readSourceFile(root, "src/a.ts", { startLine: 4, endLine: 2 }))).toBe("INVALID_ARGUMENT");
  });

  it("truncates oversized reads at a line boundary and says so", async () => {
    await writeFile(path.join(root, "big.txt"), `${"x".repeat(99)}\n`.repeat(3000));
    const r = await readSourceFile(root, "big.txt");
    expect(r.truncated).toBe(true);
    expect(Buffer.byteLength(r.content)).toBeLessThanOrEqual(MAX_READ_BYTES);
    expect(r.endLine).toBeLessThan(r.totalLines);
  });

  it("refuses secrets, .git, node_modules, traversal, absolute paths and missing files", async () => {
    expect(await code(readSourceFile(root, ".env"))).toBe("PATH_DENIED");
    expect(await code(readSourceFile(root, ".git/config"))).toBe("PATH_DENIED");
    expect(await code(readSourceFile(root, "node_modules/dep/index.js"))).toBe("PATH_DENIED");
    expect(await code(readSourceFile(root, "../outside.txt"))).toBe("PATH_OUTSIDE_WORKSPACE");
    expect(await code(readSourceFile(root, path.join(outside, "outside.txt")))).toBe("PATH_OUTSIDE_WORKSPACE");
    expect(await code(readSourceFile(root, "src/nope.ts"))).toBe("PATH_OUTSIDE_WORKSPACE");
    expect(await code(readSourceFile(root, "src"))).toBe("NOT_A_FILE");
    expect(await code(readSourceFile(root, ""))).toBe("INVALID_ARGUMENT");
  });

  it("refuses a symlink that escapes the workspace", async () => {
    await symlink(path.join(outside, "outside.txt"), path.join(root, "src", "link.txt"));
    expect(await code(readSourceFile(root, "src/link.txt"))).toBe("PATH_OUTSIDE_WORKSPACE");
  });

  it("refuses a secret reached through a symlink alias", async () => {
    await symlink(path.join(root, ".env"), path.join(root, "src", "alias.txt"));
    expect(await code(readSourceFile(root, "src/alias.txt"))).toBe("PATH_DENIED");
  });

  it("refuses binary files", async () => {
    await writeFile(path.join(root, "bin.dat"), Buffer.from([1, 2, 0, 3]));
    expect(await code(readSourceFile(root, "bin.dat"))).toBe("BINARY_FILE");
  });
});

describe("searchSourceCode", () => {
  it("finds literal matches with paths and line numbers, case-insensitively by default", async () => {
    const r = await searchSourceCode(root, "RETURN x");
    expect(r.matches).toEqual([{ path: "src/a.ts", line: 3, text: "return x + 1;" }]);
  });

  it("supports case-sensitive, regex and extension filters", async () => {
    expect((await searchSourceCode(root, "RETURN", { caseSensitive: true })).matches).toEqual([]);
    expect((await searchSourceCode(root, "^export (const|function)", { regex: true })).matches.map((m) => m.line)).toEqual([1, 2]);
    expect((await searchSourceCode(root, "a", { extensions: ["md"] })).matches).toEqual([]);
  });

  it("never searches secrets, .git or node_modules", async () => {
    expect((await searchSourceCode(root, "needle")).matches).toEqual([]);
    expect((await searchSourceCode(root, "SECRET")).matches).toEqual([]);
  });

  it("does not follow symlinks out of the workspace", async () => {
    await symlink(outside, path.join(root, "linked-dir"));
    expect((await searchSourceCode(root, "outside")).matches).toEqual([]);
  });

  it("caps results and reports truncation", async () => {
    await writeFile(path.join(root, "many.txt"), "hit\n".repeat(500));
    const r = await searchSourceCode(root, "hit", { maxResults: 7 });
    expect(r.matches).toHaveLength(7);
    expect(r.truncated).toBe(true);
  });

  it("rejects empty, oversized and invalid-regex queries", async () => {
    expect(await code(searchSourceCode(root, ""))).toBe("INVALID_ARGUMENT");
    expect(await code(searchSourceCode(root, "x".repeat(500)))).toBe("INVALID_ARGUMENT");
    expect(await code(searchSourceCode(root, "(", { regex: true }))).toBe("INVALID_ARGUMENT");
  });
});

describe("applySourcePatch", () => {
  it("applies an exact-match edit and reports line counts", async () => {
    const r = await applySourcePatch(root, [{ path: "src/a.ts", oldText: "return x + 1;", newText: "return x + 2;" }]);
    expect(r).toMatchObject({ ok: true, files: [{ path: "src/a.ts", created: false, editsApplied: 1, linesBefore: 4, linesAfter: 4 }] });
    expect(await readFile(path.join(root, "src", "a.ts"), "utf8")).toContain("x + 2");
  });

  it("applies several edits to one file in order", async () => {
    await applySourcePatch(root, [
      { path: "src/a.ts", oldText: "a = 1", newText: "a = 10" },
      { path: "src/a.ts", oldText: "a = 10;", newText: "a = 100;" }
    ]);
    expect(await readFile(path.join(root, "src", "a.ts"), "utf8")).toContain("a = 100;");
  });

  it("is atomic across files: one bad edit changes nothing", async () => {
    const before = await readFile(path.join(root, "src", "a.ts"), "utf8");
    expect(
      await code(
        applySourcePatch(root, [
          { path: "src/a.ts", oldText: "a = 1", newText: "a = 2" },
          { path: "src/b.ts", oldText: "does not exist", newText: "x" }
        ])
      )
    ).toBe("EDIT_FAILED");
    expect(await readFile(path.join(root, "src", "a.ts"), "utf8")).toBe(before);
  });

  it("rejects ambiguous and missing oldText with actionable messages", async () => {
    await writeFile(path.join(root, "dup.txt"), "x\nx\n");
    await expect(applySourcePatch(root, [{ path: "dup.txt", oldText: "x", newText: "y" }])).rejects.toThrow(/occurs 2 times/);
    await expect(applySourcePatch(root, [{ path: "src/a.ts", oldText: "nope", newText: "y" }])).rejects.toThrow(/not found/);
  });

  it("creates new files, including in new directories, but never overwrites", async () => {
    const r = await applySourcePatch(root, [{ path: "test/new/a.test.ts", oldText: "", newText: "it('x');\n" }]);
    expect(r.files[0]).toMatchObject({ path: "test/new/a.test.ts", created: true, linesAfter: 1 });
    expect(await readFile(path.join(root, "test", "new", "a.test.ts"), "utf8")).toBe("it('x');\n");
    await expect(applySourcePatch(root, [{ path: "src/a.ts", oldText: "", newText: "x" }])).rejects.toThrow(/already exists/);
  });

  it("can create a file and then edit it in the same call", async () => {
    await applySourcePatch(root, [
      { path: "fresh.ts", oldText: "", newText: "let v = 1;\n" },
      { path: "fresh.ts", oldText: "v = 1", newText: "v = 2" }
    ]);
    expect(await readFile(path.join(root, "fresh.ts"), "utf8")).toBe("let v = 2;\n");
  });

  it("refuses secrets, .git, node_modules, traversal and symlink escapes", async () => {
    expect(await code(applySourcePatch(root, [{ path: ".env", oldText: "SECRET=1", newText: "SECRET=2" }]))).toBe("PATH_DENIED");
    expect(await code(applySourcePatch(root, [{ path: ".env.local", oldText: "", newText: "X=1" }]))).toBe("PATH_DENIED");
    expect(await code(applySourcePatch(root, [{ path: ".git/hooks/pre-commit", oldText: "", newText: "evil" }]))).toBe("PATH_DENIED");
    expect(await code(applySourcePatch(root, [{ path: "node_modules/dep/index.js", oldText: "1", newText: "2" }]))).toBe("PATH_DENIED");
    expect(await code(applySourcePatch(root, [{ path: "../escape.txt", oldText: "", newText: "x" }]))).toBe("PATH_OUTSIDE_WORKSPACE");
    expect(await code(applySourcePatch(root, [{ path: path.join(outside, "new.txt"), oldText: "", newText: "x" }]))).toBe("PATH_OUTSIDE_WORKSPACE");
    await symlink(outside, path.join(root, "evil-dir"));
    expect(await code(applySourcePatch(root, [{ path: "evil-dir/new.txt", oldText: "", newText: "x" }]))).toBe("PATH_OUTSIDE_WORKSPACE");
    await expect(readFile(path.join(outside, "new.txt"), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(outside, "..", "escape.txt"), "utf8")).rejects.toThrow();
  });

  it("keeps CRLF line endings when the model sends LF text", async () => {
    await writeFile(path.join(root, "crlf.ts"), "one\r\ntwo\r\nthree\r\n");
    await applySourcePatch(root, [{ path: "crlf.ts", oldText: "two\nthree", newText: "TWO\nTHREE" }]);
    expect(await readFile(path.join(root, "crlf.ts"), "utf8")).toBe("one\r\nTWO\r\nTHREE\r\n");
  });

  it("validates the edit list shape", async () => {
    expect(await code(applySourcePatch(root, []))).toBe("INVALID_ARGUMENT");
    expect(await code(applySourcePatch(root, "x"))).toBe("INVALID_ARGUMENT");
    expect(await code(applySourcePatch(root, [{ path: "src/a.ts", oldText: 1, newText: "x" }]))).toBe("INVALID_ARGUMENT");
    expect(await code(applySourcePatch(root, [{ path: "src/a.ts", oldText: "a", newText: "a" }]))).toBe("INVALID_ARGUMENT");
    expect(await code(applySourcePatch(root, Array.from({ length: 51 }, () => ({ path: "src/a.ts", oldText: "a", newText: "b" }))))).toBe("INVALID_ARGUMENT");
  });

  it("refuses to edit binary files and leaves no temp files behind", async () => {
    await writeFile(path.join(root, "bin.dat"), Buffer.from([1, 0, 2]));
    expect(await code(applySourcePatch(root, [{ path: "bin.dat", oldText: "x", newText: "y" }]))).toBe("BINARY_FILE");
    await applySourcePatch(root, [{ path: "src/a.ts", oldText: "a = 1", newText: "a = 3" }]);
    const { readdir } = await import("node:fs/promises");
    expect((await readdir(path.join(root, "src"))).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});
