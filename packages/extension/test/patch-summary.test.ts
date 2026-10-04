import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fenced, summarizePatch } from "../src/ai/patchSummary.ts";

describe("summarizePatch", () => {
  it("summarizes a single edit with before/after previews", () => {
    const s = summarizePatch({ edits: [{ path: "src/a.ts", oldText: "a = 1", newText: "a = 2" }] });
    assert.equal(s.valid, true);
    assert.equal(s.title, "Edit src/a.ts");
    assert.match(s.markdown, /1\*\* file \(1 edit\)/);
    assert.match(s.markdown, /`src\/a\.ts` — 1 edit/);
    assert.match(s.markdown, /replaces:/);
    assert.match(s.markdown, /a = 1/);
    assert.match(s.markdown, /a = 2/);
  });

  it("says when a file is created", () => {
    const s = summarizePatch({ edits: [{ path: "test/new.test.ts", oldText: "", newText: "it('x')" }] });
    assert.match(s.markdown, /create new file/);
    assert.match(s.markdown, /starts with/);
  });

  it("groups edits per file, counts them, and caps the listing", () => {
    const edits = Array.from({ length: 12 }, (_, i) => ({ path: `f${i}.ts`, oldText: "a", newText: "b" }));
    const s = summarizePatch({ edits: [...edits, { path: "f0.ts", oldText: "c", newText: "d" }] });
    assert.equal(s.title, "Edit 12 files");
    assert.match(s.markdown, /\*\*12\*\* files \(13 edits\)/);
    assert.match(s.markdown, /`f0\.ts` — 2 edits/);
    assert.match(s.markdown, /…and 4 more/);
  });

  it("truncates long previews", () => {
    const s = summarizePatch({ edits: [{ path: "a", oldText: "x".repeat(1000), newText: "y" }] });
    assert.ok(!s.markdown.includes("x".repeat(300)));
    assert.match(s.markdown, /…/);
  });

  it("reports malformed input instead of throwing", () => {
    for (const bad of [undefined, null, {}, { edits: [] }, { edits: "x" }, { edits: [{ path: "a" }] }, { edits: [null] }]) {
      const s = summarizePatch(bad);
      assert.equal(s.valid, false, JSON.stringify(bad));
      assert.match(s.markdown, /malformed/);
    }
  });

  it("cannot be used to break out of the code fence or inject markdown via the path", () => {
    const evil = "```\n[click](https://evil.example)\n```";
    const s = summarizePatch({ edits: [{ path: "a`b", oldText: evil, newText: "x" }] });
    // The hostile content contains runs of three backticks, so it must be wrapped in a 4+ fence.
    const lines = s.markdown.split("\n");
    const open = lines.indexOf("````");
    const close = lines.indexOf("````", open + 1);
    assert.ok(open !== -1 && close > open, "hostile content must be enclosed by a 4-backtick fence");
    const inside = lines.slice(open + 1, close).join("\n");
    assert.ok(inside.includes("[click](https://evil.example)"), "the hostile text stays inside the fence");
    assert.ok(!s.markdown.includes("`a`b`"), "backticks in paths are neutralized");
  });
});

describe("fenced", () => {
  it("uses a fence longer than the longest backtick run", () => {
    assert.equal(fenced("x"), "```\nx\n```");
    assert.equal(fenced("a ``` b"), "````\na ``` b\n````");
  });
});
