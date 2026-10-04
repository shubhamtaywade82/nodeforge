import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { folderContaining, resolveActiveFolder } from "../src/core/activeFolder.ts";

const folders = [
  { name: "api", fsPath: "/w/api" },
  { name: "web", fsPath: "/w/web" },
  { name: "web-nested", fsPath: "/w/web/nested" }
];

describe("resolveActiveFolder", () => {
  it("defaults to the first folder", () => assert.equal(resolveActiveFolder(folders, undefined)?.name, "api"));
  it("honours a valid selection", () => assert.equal(resolveActiveFolder(folders, "/w/web")?.name, "web"));
  it("falls back to the first folder when the selection was removed", () =>
    assert.equal(resolveActiveFolder(folders, "/w/gone")?.name, "api"));
  it("returns undefined with no folders", () => assert.equal(resolveActiveFolder([], "/w/web"), undefined));
});

describe("folderContaining", () => {
  it("picks the deepest containing folder", () =>
    assert.equal(folderContaining(folders, "/w/web/nested/a.ts", "/")?.name, "web-nested"));
  it("does not match a sibling that merely shares a prefix", () =>
    assert.equal(folderContaining(folders, "/w/web-other/a.ts", "/"), undefined));
});
