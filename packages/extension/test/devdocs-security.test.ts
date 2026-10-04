import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, isDevDocsUrl } from "../src/docs/devdocsSecurity.ts";

describe("isDevDocsUrl", () => {
  it("accepts https devdocs.io", () => {
    assert.equal(isDevDocsUrl("https://devdocs.io/node/fs"), true);
  });
  for (const bad of [
    "http://devdocs.io/",
    "https://devdocs.io.evil.com/",
    "https://evil.com/?https://devdocs.io",
    "https://user@devdocs.io/",
    "https://devdocs.io:8443/",
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "not a url",
    ""
  ]) {
    it(`rejects ${JSON.stringify(bad)}`, () => assert.equal(isDevDocsUrl(bad), false));
  }
});

describe("escapeHtml", () => {
  it("escapes attribute-breaking characters", () => {
    assert.equal(escapeHtml(`"><script>&'`), "&quot;&gt;&lt;script&gt;&amp;&#39;");
  });
});
