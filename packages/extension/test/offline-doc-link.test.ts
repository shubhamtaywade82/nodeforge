import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSafeDocFile, isSafeDocSlug, offlineDocCommandLink, parseOfflineDocArgs, plainMarkdownText } from "../src/docs/offlineDocLink.ts";

describe("offline doc references", () => {
  it("accepts normal docset slugs and files", () => {
    assert.ok(isSafeDocSlug("node~20_lts"));
    assert.ok(isSafeDocSlug("typescript"));
    assert.ok(isSafeDocFile("child_process.html"));
    assert.ok(isSafeDocFile("api/fs.html"));
  });
  for (const bad of ["", "..", "../x", "a/b", "-x", ".hidden", "a..b", "x".repeat(81), 5, undefined]) {
    it(`rejects slug ${JSON.stringify(bad)}`, () => assert.equal(isSafeDocSlug(bad), false));
  }
  for (const bad of ["../a.html", "a/../b.html", "/etc/a.html", "a\\b.html", "a.txt", "a\0.html", "a//b.html", "./a.html", "", "x".repeat(201) + ".html"]) {
    it(`rejects file ${JSON.stringify(bad)}`, () => assert.equal(isSafeDocFile(bad), false));
  }
  it("parses only complete valid arguments", () => {
    assert.deepEqual(parseOfflineDocArgs({ slug: "node", htmlFile: "fs.html", extra: 1 }), { slug: "node", htmlFile: "fs.html" });
    assert.equal(parseOfflineDocArgs({ slug: "node" }), undefined);
    assert.equal(parseOfflineDocArgs({ slug: "../node", htmlFile: "fs.html" }), undefined);
    assert.equal(parseOfflineDocArgs(null), undefined);
  });
  it("builds a link that round-trips and cannot end early", () => {
    const link = offlineDocCommandLink("nodeforge.openOfflineDoc", { slug: "node", htmlFile: "a(b).html" }, "Open");
    const m = /^\[Open\]\(command:nodeforge\.openOfflineDoc\?([^)]*)\)$/.exec(link);
    assert.ok(m, link);
    assert.deepEqual(JSON.parse(decodeURIComponent(m[1] as string)), [{ slug: "node", htmlFile: "a(b).html" }]);
  });
  it("neutralises markdown structure in docset text", () => {
    assert.equal(plainMarkdownText("a`b`\n[c](command:x)<d>"), "a b c command:x d");
  });
});
