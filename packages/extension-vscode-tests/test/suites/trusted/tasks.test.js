const assert = require("node:assert");
const vscode = require("vscode");
const { activateExtension } = require("../../lib/helpers");

suite("Task provider", () => {
  let tasks                = [];

  suiteSetup(async () => {
    await activateExtension();
    tasks = await vscode.tasks.fetchTasks({ type: "nodeforge" });
  });

  const byScript = (script        )              => {
    const task = tasks.find((t) => (t.definition                       ).script === script);
    assert.ok(task, `no task for script "${script}"; got ${tasks.map((t) => t.name).join(", ")}`);
    return task;
  };

  test("exposes one task per package.json script", () => {
    const scripts = tasks.map((t) => (t.definition                       ).script ?? "").sort();
    assert.deepStrictEqual(scripts, ["build", "clean", "dev", "lint", "test", "typecheck"]);
  });

  test("build gets the tsc matcher and the build group", () => {
    const build = byScript("build");
    assert.deepStrictEqual(build.problemMatchers, ["$tsc"]);
    assert.strictEqual(build.group?.id, vscode.TaskGroup.Build.id);
  });

  test("lint gets the eslint matcher; typecheck --watch is a background tsc-watch task", () => {
    assert.deepStrictEqual(byScript("lint").problemMatchers, ["$eslint-stylish"]);
    const typecheck = byScript("typecheck");
    assert.deepStrictEqual(typecheck.problemMatchers, ["$tsc-watch"]);
    assert.strictEqual(typecheck.isBackground, true);
  });

  test("test and dev scripts are grouped/background as expected", () => {
    assert.strictEqual(byScript("test").group?.id, vscode.TaskGroup.Test.id);
    assert.strictEqual(byScript("dev").isBackground, true);
    assert.strictEqual(byScript("clean").group?.id, vscode.TaskGroup.Clean.id);
  });

  test("tasks run through the detected package manager in the workspace root", () => {
    const exec = byScript("build").execution                           ;
    assert.strictEqual(exec.process, "npm");
    assert.deepStrictEqual(exec.args, ["run", "build"]);
  });
});
