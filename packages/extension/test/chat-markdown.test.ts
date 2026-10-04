import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// Load exactly like the webview does: a classic script that sets a global.
const sandbox: { self: Record<string, unknown> } = { self: {} };
runInNewContext(readFileSync(new URL("../media/chat/markdown.js", import.meta.url), "utf8"), sandbox);
const { renderMarkdown } = sandbox.self.NodeForgeMarkdown as { renderMarkdown: (text: string) => string };

describe("chat markdown renderer", () => {
  it("escapes raw HTML", () => {
    const out = renderMarkdown(`<img src=x onerror=alert(1)><script>alert(1)</script>`);
    assert.doesNotMatch(out, /<img|<script/);
    assert.match(out, /&lt;script&gt;/);
  });

  it("does not turn markdown links or images into elements", () => {
    const out = renderMarkdown("[x](javascript:alert(1)) ![y](https://evil/x.png)");
    assert.doesNotMatch(out, /<a |<img /);
  });

  it("keeps code content literal and escaped", () => {
    const out = renderMarkdown("```ts\nconst a = '<b>**x**</b>';\n```");
    assert.match(out, /<pre class="code-block"><code>const a = &#39;&lt;b&gt;\*\*x\*\*&lt;\/b&gt;&#39;;<\/code><\/pre>/);
    assert.doesNotMatch(out, /<strong>/);
  });

  it("a NUL placeholder in input cannot smuggle code blocks or throw", () => {
    const out = renderMarkdown("\u00000\u0000 and ```\nx\n```");
    assert.match(out, /<pre class="code-block"><code>x<\/code><\/pre>/);
    assert.equal(out.includes("\u0000"), false);
    assert.equal((out.match(/<pre/g) ?? []).length, 1);
  });

  it("renders bold, headings and lists", () => {
    const out = renderMarkdown("## T\n\n**b**\n\n- a\n- b");
    assert.match(out, /<h2>T<\/h2>/);
    assert.match(out, /<strong>b<\/strong>/);
    assert.match(out, /<ul><li>a<\/li>\n?<li>b<\/li><\/ul>/);
  });
});
