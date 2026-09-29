const test = require("node:test");
const assert = require("node:assert/strict");

test("adds numbers", () => {
  assert.equal(1 + 1, 2);
});

test("handles strings", () => {
  assert.equal(["node", "test"].join("-"), "node-test");
});

test("skipped until integration service exists", { skip: "integration service unavailable" }, () => {
  throw new Error("must not execute");
});

test("todo follow-up", { todo: "add broader coverage" }, () => {
  assert.equal("node", "node");
});
