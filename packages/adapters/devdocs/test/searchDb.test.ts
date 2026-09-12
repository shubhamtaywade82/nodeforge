import { describe, expect, it } from "vitest";

import { searchDevDocsDb } from "../src/searchDb.js";

describe("searchDevDocsDb", () => {
  it("finds pages by keyword in content", () => {
    const db = {
      index: "<h1>Index</h1>",
      child_process: "<p>spawn() creates a child process.</p>"
    };
    const hits = searchDevDocsDb("node", db, "spawn");
    expect(hits.length).toBe(1);
    expect(hits[0]?.pageKey).toBe("child_process");
    expect(hits[0]?.htmlFile).toBe("child_process.html");
  });

  it("returns empty for blank query", () => {
    expect(searchDevDocsDb("node", { fs: "<p>file system</p>" }, "   ")).toEqual([]);
  });
});
