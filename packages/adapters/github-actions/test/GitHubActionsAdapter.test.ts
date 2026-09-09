/**
 * Tests for the GitHub Actions adapter.
 */

import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { GitHubActionsAdapter, parseWorkflow } from "../src/GitHubActionsAdapter.js";

const FIXTURE = path.resolve(__dirname, "../../../test-fixtures/node-ts-docker");

describe("parseWorkflow", () => {
  it("parses a basic workflow with push trigger", () => {
    const yaml = [
      "name: CI",
      "on:",
      "  push:",
      "    branches: [main]",
      "    paths: ['src/**']",
      "jobs:",
      "  test:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - run: npm test"
    ].join("\n");
    const wf = parseWorkflow(yaml, "/test/ci.yml");
    expect(wf.name).toBe("CI");
    expect(wf.triggers).toHaveLength(1);
    expect(wf.triggers[0]!.kind).toBe("push");
    expect(wf.triggers[0]!.branches).toEqual(["main"]);
    expect(wf.triggers[0]!.paths).toEqual(["src/**"]);
    expect(wf.jobs).toHaveLength(1);
    expect(wf.jobs[0]!.id).toBe("test");
    expect(wf.jobs[0]!.job.runsOn).toBe("ubuntu-latest");
    expect(wf.jobs[0]!.job.steps).toHaveLength(2);
    expect(wf.jobs[0]!.job.steps[0]!.uses).toBe("actions/checkout@v4");
    expect(wf.jobs[0]!.job.steps[1]!.run).toBe("npm test");
  });

  it("handles string-form trigger", () => {
    const yaml = ["name: Simple", "on: push", "jobs: { build: { runs-on: ubuntu-latest, steps: [{ run: echo hi }] } }"].join("\n");
    const wf = parseWorkflow(yaml, "/test/simple.yml");
    expect(wf.triggers).toEqual([{ kind: "push" }]);
  });

  it("handles array-form trigger", () => {
    const yaml = [
      "name: Multi",
      "on: [push, pull_request]",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: echo hi"
    ].join("\n");
    const wf = parseWorkflow(yaml, "/test/multi.yml");
    expect(wf.triggers).toEqual([{ kind: "push" }, { kind: "pull_request" }]);
  });

  it("parses workflow_dispatch inputs", () => {
    const yaml = [
      "name: Dispatch",
      "on:",
      "  workflow_dispatch:",
      "    inputs:",
      "      debug:",
      "        type: boolean",
      "        default: false",
      "        description: Enable debug",
      "jobs:",
      "  run:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: echo hi"
    ].join("\n");
    const wf = parseWorkflow(yaml, "/test/dispatch.yml");
    expect(wf.triggers[0]!.kind).toBe("workflow_dispatch");
    expect(wf.triggers[0]!.inputs!["debug"]).toBeDefined();
    expect(wf.triggers[0]!.inputs!["debug"]!.type).toBe("boolean");
    expect(wf.triggers[0]!.inputs!["debug"]!.default).toBe(false);
  });

  it("parses schedule triggers with cron", () => {
    const yaml = [
      "name: Cron",
      "on:",
      "  schedule:",
      "    - cron: '0 2 * * 1'",
      "jobs:",
      "  run:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: echo hi"
    ].join("\n");
    const wf = parseWorkflow(yaml, "/test/cron.yml");
    expect(wf.triggers[0]!.cron).toEqual(["0 2 * * 1"]);
  });

  it("parses job needs and strategy matrix", () => {
    const yaml = [
      "name: Matrix",
      "on: push",
      "jobs:",
      "  test:",
      "    runs-on: ubuntu-latest",
      "    strategy:",
      "      fail-fast: false",
      "      matrix:",
      "        node: ['20', '22']",
      "    steps:",
      "      - run: echo ${{ matrix.node }}",
      "  build:",
      "    needs: test",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: echo build"
    ].join("\n");
    const wf = parseWorkflow(yaml, "/test/matrix.yml");
    const test = wf.jobs.find((j) => j.id === "test")!;
    expect(test.job.strategy!.matrix).toEqual({ node: ["20", "22"] });
    expect(test.job.strategy!.failFast).toBe(false);
    const build = wf.jobs.find((j) => j.id === "build")!;
    expect(build.job.needs).toEqual(["test"]);
  });

  it("parses env, concurrency, permissions", () => {
    const yaml = [
      "name: CI",
      "on: push",
      "env:",
      "  NODE_VERSION: '20'",
      "concurrency:",
      "  group: ci-${{ github.ref }}",
      "  cancel-in-progress: true",
      "permissions:",
      "  contents: read",
      "  pull-requests: write",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: echo hi"
    ].join("\n");
    const wf = parseWorkflow(yaml, "/test/ci.yml");
    expect(wf.env).toEqual({ NODE_VERSION: "20" });
    expect(wf.concurrency!.group).toBe("ci-${{ github.ref }}");
    expect(wf.concurrency!.cancelInProgress).toBe(true);
    expect(wf.permissions).toEqual({ contents: "read", "pull-requests": "write" });
  });

  it("parses step with: inputs and if conditions", () => {
    const yaml = [
      "name: CI",
      "on: push",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - name: Setup",
      "        uses: actions/setup-node@v4",
      "        with:",
      "          node-version: 20",
      "          cache: npm",
      "      - name: Lint",
      "        run: npm run lint",
      "        if: always()"
    ].join("\n");
    const wf = parseWorkflow(yaml, "/test/ci.yml");
    const steps = wf.jobs[0]!.job.steps;
    expect(steps[0]!.with).toEqual({ "node-version": 20, cache: "npm" });
    expect(steps[1]!.if).toBe("always()");
  });

  it("throws AdapterParseError for workflow without jobs", () => {
    expect(() => parseWorkflow("name: Bad\non: push\n", "/test/bad.yml")).toThrow(/no 'jobs'/);
  });
});

describe("GitHubActionsAdapter (integration against fixture)", () => {
  it("detects all workflows in .github/workflows/", async () => {
    const adapter = new GitHubActionsAdapter();
    const result = await adapter.detect(FIXTURE);

    expect(result.workflows.length).toBe(2);

    const ci = result.workflows.find((w) => w.name === "CI")!;
    expect(ci).toBeDefined();
    expect(ci.triggers.length).toBe(3); // push, pull_request, workflow_dispatch
    expect(ci.triggers.map((t) => t.kind).sort()).toEqual(["pull_request", "push", "workflow_dispatch"]);
    expect(ci.triggers.find((t) => t.kind === "push")!.branches).toEqual(["main", "develop"]);
    expect(ci.triggers.find((t) => t.kind === "push")!.paths).toEqual([
      "src/**",
      "package.json",
      ".github/workflows/ci.yml"
    ]);
    expect(ci.triggers.find((t) => t.kind === "workflow_dispatch")!.inputs!["debug"]).toBeDefined();
    expect(ci.env).toEqual({ NODE_VERSION: "20", CI: "true" });
    expect(ci.concurrency!.cancelInProgress).toBe(true);
    expect(ci.permissions).toEqual({ contents: "read", "pull-requests": "write" });
    expect(ci.jobs.length).toBe(3); // test, build, deploy
    const test = ci.jobs.find((j) => j.id === "test")!;
    expect(test.job.strategy!.matrix).toEqual({ node: ["20", "22"] });
    expect(test.job.timeoutMinutes).toBe(15);
    const deploy = ci.jobs.find((j) => j.id === "deploy")!;
    expect(deploy.job.needs).toEqual(["build"]);
    expect(deploy.job.if).toBe("github.ref == 'refs/heads/main'");

    const release = result.workflows.find((w) => w.name === "Release")!;
    expect(release.triggers.find((t) => t.kind === "push")!.tags).toEqual(["v*"]);
    expect(release.triggers.find((t) => t.kind === "schedule")!.cron).toEqual(["0 2 * * 1"]);
  });

  it("detects config presence via hasConfig", async () => {
    expect(await GitHubActionsAdapter.hasConfig(FIXTURE)).toBe(true);
    expect(await GitHubActionsAdapter.hasConfig(path.dirname(FIXTURE))).toBe(false);
  });
});
