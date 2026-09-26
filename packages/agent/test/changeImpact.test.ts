import { describe, expect, it } from "vitest";
import { analyzeChangeImpact } from "../src/changeImpact.js";
import type { DependencyGraph } from "@nodeforge/contracts";

const root = "/workspace";
const file = (name: string): string => root + "/src/" + name;

const graph: DependencyGraph = {
  root,
  declaredPackages: [{ name: "zod", version: "^4", dependencyType: "prod" }],
  nodes: [
    ...["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"].map((name) => ({
      id: file(name),
      kind: "file" as const,
      name,
      path: file(name),
      isExternal: false
    })),
    { id: "zod", kind: "package", name: "zod", isExternal: true }
  ],
  edges: [
    { from: file("b.ts"), to: file("a.ts"), kind: "static", specifier: "./a.js" },
    { from: file("c.ts"), to: file("b.ts"), kind: "static", specifier: "./b.js" },
    { from: file("d.ts"), to: file("c.ts"), kind: "static", specifier: "./c.js" },
    { from: file("a.ts"), to: "zod", kind: "static", specifier: "zod" },
    { from: file("e.ts"), to: file("a.ts"), kind: "type", specifier: "./a.js" }
  ]
};

describe("analyzeChangeImpact", () => {
  it("finds direct and transitive dependencies and dependents", () => {
    expect(analyzeChangeImpact(root, graph, ["src/a.ts"])).toEqual({
      files: ["src/a.ts"],
      directDependencies: [],
      transitiveDependencies: [],
      directDependents: ["src/b.ts", "src/e.ts"],
      transitiveDependents: ["src/c.ts", "src/d.ts"],
      externalPackages: ["zod"],
      touchedCircularDependencies: []
    });
  });

  it("handles a changed file that imports local files", () => {
    expect(analyzeChangeImpact(root, graph, ["src/b.ts"])).toEqual({
      files: ["src/b.ts"],
      directDependencies: ["src/a.ts"],
      transitiveDependencies: [],
      directDependents: ["src/c.ts"],
      transitiveDependents: ["src/d.ts"],
      externalPackages: ["zod"],
      touchedCircularDependencies: []
    });
  });

  it("reports cycles touching the changed file", () => {
    const cyclic: DependencyGraph = {
      ...graph,
      edges: [
        ...graph.edges,
        { from: file("a.ts"), to: file("c.ts"), kind: "static", specifier: "./c.js" }
      ]
    };

    const result = analyzeChangeImpact(root, cyclic, ["src/a.ts"]);
    expect(result.touchedCircularDependencies).toEqual([
      ["src/a.ts", "src/c.ts", "src/b.ts", "src/a.ts"]
    ]);
  });

  it("rejects files outside the workspace", () => {
    expect(() => analyzeChangeImpact(root, graph, ["../outside.ts"])).toThrow(
      "inside the workspace"
    );
  });
});
