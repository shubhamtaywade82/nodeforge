/**
 * Tests for the Git adapter.
 *
 * Includes pure-parser unit tests and integration tests that create a real
 * temporary git repo (with commits, branches, and dirty changes) and verify
 * the adapter reads the state correctly.
 */

import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { GitAdapter, parsePorcelainBranchHeader } from "../src/GitAdapter.js";
import { ProcessRunner } from "@nodeforge/runner";

describe("parsePorcelainBranchHeader (pure parser)", () => {
  it("parses branch.head and branch.oid", () => {
    const stdout = [
      "# branch.head main",
      "# branch.oid a0c87ab3e2ff7184e390baeb36eda4b1e25f125b",
      ""
    ].join("\n");
    const parsed = parsePorcelainBranchHeader(stdout);
    expect(parsed.branch).toBe("main");
    expect(parsed.oid).toBe("a0c87ab3e2ff7184e390baeb36eda4b1e25f125b");
  });

  it("parses branch.upstream", () => {
    const stdout = "# branch.upstream origin/main\n";
    const parsed = parsePorcelainBranchHeader(stdout);
    expect(parsed.upstream).toBe("origin/main");
  });

  it("parses branch.ab ahead/behind", () => {
    const stdout = "# branch.ab +3 -1\n";
    const parsed = parsePorcelainBranchHeader(stdout);
    expect(parsed.ahead).toBe(3);
    expect(parsed.behind).toBe(1);
  });

  it("parses a complete branch header block", () => {
    const stdout = [
      "# branch.head feature/foo",
      "# branch.oid deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      "# branch.upstream origin/feature/foo",
      "# branch.ab +2 -0",
      ""
    ].join("\n");
    const parsed = parsePorcelainBranchHeader(stdout);
    expect(parsed.branch).toBe("feature/foo");
    expect(parsed.oid).toBe("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
    expect(parsed.upstream).toBe("origin/feature/foo");
    expect(parsed.ahead).toBe(2);
    expect(parsed.behind).toBe(0);
  });

  it("ignores non-header lines", () => {
    const stdout = [
      "# branch.head main",
      "1 .M N... 100644 100644 100644 <hash> <hash> file.txt",
      "? untracked.txt",
      ""
    ].join("\n");
    const parsed = parsePorcelainBranchHeader(stdout);
    expect(parsed.branch).toBe("main");
    expect(parsed.oid).toBeUndefined();
    expect(parsed.ahead).toBeUndefined();
  });

  it("returns empty object for empty stdout", () => {
    expect(parsePorcelainBranchHeader("")).toEqual({});
  });
});

describe("GitAdapter (integration against real git repo)", () => {
  let tmpDir: string;

  async function mkRepo(): Promise<string> {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), "nodeforge-git-"));
    await runRaw(repo, "git", ["init", "-q", "-b", "main"]);
    await runRaw(repo, "git", ["config", "user.email", "test@example.com"]);
    await runRaw(repo, "git", ["config", "user.name", "Test User"]);
    await runRaw(repo, "git", ["config", "commit.gpgSign", "false"]);
    return repo;
  }

  async function commit(repo: string, msg: string): Promise<void> {
    await runRaw(repo, "git", ["commit", "-q", "-m", msg]);
  }

  async function writeFile(repo: string, relPath: string, content: string): Promise<void> {
    const abs = path.join(repo, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
  }

  it("returns undefined for a non-git directory", async () => {
    const runner = new ProcessRunner();
    const adapter = new GitAdapter(runner);
    const nonRepo = await fs.mkdtemp(path.join(os.tmpdir(), "nodeforge-nongit-"));
    const state = await adapter.detect(nonRepo);
    expect(state).toBeUndefined();
  });

  it("detects branch, head short, and clean state on a fresh repo", async () => {
    const runner = new ProcessRunner();
    const adapter = new GitAdapter(runner);
    const repo = await mkRepo();
    await writeFile(repo, "file1.txt", "hello\n");
    await runRaw(repo, "git", ["add", "."]);
    await commit(repo, "initial commit");

    const state = await adapter.detect(repo);
    expect(state).toBeDefined();
    expect(state!.branch).toBe("main");
    expect(state!.detached).toBe(false);
    expect(state!.headShort.length).toBe(10);
    expect(state!.dirty).toBe(false);
    expect(state!.changedFiles).toEqual([]);
    expect(state!.stagedFiles).toEqual([]);
    expect(state!.upstream).toBeUndefined();
    expect(state!.ahead).toBe(0);
    expect(state!.behind).toBe(0);

    await fs.rm(repo, { recursive: true, force: true });
  });

  it("detects unstaged and staged changes", async () => {
    const runner = new ProcessRunner();
    const adapter = new GitAdapter(runner);
    const repo = await mkRepo();
    await writeFile(repo, "file1.txt", "hello\n");
    await runRaw(repo, "git", ["add", "."]);
    await commit(repo, "first");

    // Modify an existing file (unstaged).
    await writeFile(repo, "file1.txt", "modified\n");
    // Add a new file and stage it.
    await writeFile(repo, "file2.txt", "new\n");
    await runRaw(repo, "git", ["add", "file2.txt"]);

    const state = await adapter.detect(repo);
    expect(state).toBeDefined();
    expect(state!.dirty).toBe(true);
    expect(state!.changedFiles).toEqual(["file1.txt"]);
    expect(state!.stagedFiles).toEqual(["file2.txt"]);

    await fs.rm(repo, { recursive: true, force: true });
  });

  it("detects detached HEAD state", async () => {
    const runner = new ProcessRunner();
    const adapter = new GitAdapter(runner);
    const repo = await mkRepo();
    await writeFile(repo, "file1.txt", "hello\n");
    await runRaw(repo, "git", ["add", "."]);
    await commit(repo, "first");
    // Detach by checking out the commit by hash.
    const headResult = await runRaw(repo, "git", ["rev-parse", "HEAD"]);
    const headHash = headResult.stdout.trim();
    await runRaw(repo, "git", ["checkout", "-q", headHash]);

    const state = await adapter.detect(repo);
    expect(state).toBeDefined();
    expect(state!.branch).toBe("HEAD");
    expect(state!.detached).toBe(true);

    await fs.rm(repo, { recursive: true, force: true });
  });

  it("detects feature branches", async () => {
    const runner = new ProcessRunner();
    const adapter = new GitAdapter(runner);
    const repo = await mkRepo();
    await writeFile(repo, "file1.txt", "hello\n");
    await runRaw(repo, "git", ["add", "."]);
    await commit(repo, "first");
    await runRaw(repo, "git", ["checkout", "-q", "-b", "feature/cool-stuff"]);

    const state = await adapter.detect(repo);
    expect(state).toBeDefined();
    expect(state!.branch).toBe("feature/cool-stuff");
    expect(state!.detached).toBe(false);

    await fs.rm(repo, { recursive: true, force: true });
  });

  it("detects ahead/behind via branch.ab when upstream is set", async () => {
    const runner = new ProcessRunner();
    const adapter = new GitAdapter(runner);
    const repo = await mkRepo();
    await writeFile(repo, "file1.txt", "hello\n");
    await runRaw(repo, "git", ["add", "."]);
    await commit(repo, "first");

    // Set up a fake "remote" by cloning the same repo and adding as origin.
    const cloneDir = await fs.mkdtemp(path.join(os.tmpdir(), "nodeforge-git-clone-"));
    await runRaw(repo, "git", ["clone", "-q", repo, cloneDir]);
    await runRaw(repo, "git", ["remote", "add", "origin", cloneDir]);
    await runRaw(repo, "git", ["fetch", "-q", "origin"]);
    await runRaw(repo, "git", ["branch", "--set-upstream-to=origin/main"]);

    // Make an extra commit on the local repo to be "ahead" by 1.
    await writeFile(repo, "file2.txt", "more\n");
    await runRaw(repo, "git", ["add", "."]);
    await commit(repo, "second");

    const state = await adapter.detect(repo);
    expect(state).toBeDefined();
    expect(state!.upstream).toBe("origin/main");
    expect(state!.ahead).toBe(1);
    expect(state!.behind).toBe(0);

    await fs.rm(repo, { recursive: true, force: true });
    await fs.rm(cloneDir, { recursive: true, force: true });
  });

  it("isGitRepo returns true for a git repo, false otherwise", async () => {
    const runner = new ProcessRunner();
    const repo = await mkRepo();
    await writeFile(repo, "f.txt", "x\n");
    await runRaw(repo, "git", ["add", "."]);
    await commit(repo, "x");

    const nonRepo = await fs.mkdtemp(path.join(os.tmpdir(), "nodeforge-nongit-"));

    expect(await GitAdapter.isGitRepo(repo, runner)).toBe(true);
    expect(await GitAdapter.isGitRepo(nonRepo, runner)).toBe(false);

    await fs.rm(repo, { recursive: true, force: true });
    await fs.rm(nonRepo, { recursive: true, force: true });
  });
});

async function runRaw(
  cwd: string,
  command: string,
  args: string[]
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const runner = new ProcessRunner();
  const result = await runner.run({ command, args, cwd });
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}
