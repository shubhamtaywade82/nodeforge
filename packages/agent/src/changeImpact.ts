import * as path from "node:path";
import type { ChangeImpact, DependencyGraph } from "@nodeforge/contracts";

export function analyzeChangeImpact(
  workspaceRoot: string,
  graph: DependencyGraph,
  inputFiles: readonly string[]
): ChangeImpact {
  const changed = normalizeChangedFiles(workspaceRoot, inputFiles);
  const fileNodes = new Set(
    graph.nodes.filter((node) => node.kind === "file").map((node) => node.id)
  );
  const fileEdges = graph.edges.filter(
    (edge) =>
      fileNodes.has(edge.from) &&
      fileNodes.has(edge.to)
  );

  const downstream = traverse(changed, fileEdges, "forward");
  const upstream = traverse(changed, fileEdges, "reverse");

  const directDependencies = [...downstream.direct];
  const transitiveDependencies = [...downstream.all].filter(
    (file) => !downstream.direct.has(file)
  );

  const directDependents = [...upstream.direct];
  const transitiveDependents = [...upstream.all].filter(
    (file) => !upstream.direct.has(file)
  );

  const affected = new Set([
    ...changed,
    ...directDependencies,
    ...transitiveDependencies,
    ...directDependents,
    ...transitiveDependents
  ]);

  const externalPackages = unique(
    graph.edges
      .filter((edge) => affected.has(edge.from) && !fileNodes.has(edge.to))
      .map((edge) => edge.to)
  ).sort();

  const touchedCircularDependencies = graphCircularChainsForChangedFiles(
    graph,
    changed
  );

  return {
    files: changed.map((file) => path.relative(workspaceRoot, file)),
    directDependencies: directDependencies
      .map((file) => path.relative(workspaceRoot, file))
      .sort(),
    transitiveDependencies: transitiveDependencies
      .map((file) => path.relative(workspaceRoot, file))
      .sort(),
    directDependents: directDependents
      .map((file) => path.relative(workspaceRoot, file))
      .sort(),
    transitiveDependents: transitiveDependents
      .map((file) => path.relative(workspaceRoot, file))
      .sort(),
    externalPackages,
    touchedCircularDependencies: touchedCircularDependencies.map((chain) =>
      chain.map((file) => path.relative(workspaceRoot, file))
    )
  };
}

function normalizeChangedFiles(
  workspaceRoot: string,
  files: readonly string[]
): string[] {
  return unique(
    files
      .map((file) => {
        const absolute = path.resolve(workspaceRoot, file);
        const relative = path.relative(workspaceRoot, absolute);
        if (
          relative === "" ||
          relative.startsWith(".." + path.sep) ||
          path.isAbsolute(relative)
        ) {
          throw new Error("Change-impact file must be inside the workspace: " + file);
        }
        return absolute;
      })
  );
}

function traverse(
  roots: readonly string[],
  edges: readonly DependencyGraph["edges"][number][],
  direction: "forward" | "reverse"
): { direct: Set<string>; all: Set<string> } {
  const adjacency = new Map<string, string[]>();

  for (const edge of edges) {
    const from = direction === "forward" ? edge.from : edge.to;
    const to = direction === "forward" ? edge.to : edge.from;
    const values = adjacency.get(from) ?? [];
    values.push(to);
    adjacency.set(from, values);
  }

  const direct = new Set<string>();
  const all = new Set<string>();
  const queue = roots.map((root) => ({ root, node: root, depth: 0 }));

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current.node) ?? []) {
      if (roots.includes(next)) continue;
      if (current.depth === 0) {
        direct.add(next);
      }
      if (all.has(next)) continue;
      all.add(next);
      queue.push({ root: current.root, node: next, depth: current.depth + 1 });
    }
  }

  return { direct, all };
}

function graphCircularChainsForChangedFiles(
  graph: DependencyGraph,
  changed: readonly string[]
): string[][] {
  const changedSet = new Set(changed);
  return detectCycles(graph)
    .filter((chain) => chain.some((file) => changedSet.has(file)))
    .map((chain) => [...chain]);
}

function detectCycles(graph: DependencyGraph): string[][] {
  const fileNodes = new Set(
    graph.nodes.filter((node) => node.kind === "file").map((node) => node.id)
  );
  const adjacency = new Map<string, string[]>();

  for (const edge of graph.edges) {
    if (!fileNodes.has(edge.from) || !fileNodes.has(edge.to)) continue;
    const values = adjacency.get(edge.from) ?? [];
    values.push(edge.to);
    adjacency.set(edge.from, values);
  }

  const cycles: string[][] = [];
  const active = new Set<string>();
  const stack: string[] = [];

  const visit = (node: string): void => {
    if (active.has(node)) {
      const start = stack.indexOf(node);
      if (start >= 0) cycles.push([...stack.slice(start), node]);
      return;
    }

    active.add(node);
    stack.push(node);
    for (const next of adjacency.get(node) ?? []) visit(next);
    stack.pop();
    active.delete(node);
  };

  for (const node of adjacency.keys()) visit(node);

  return dedupeCycles(cycles);
}

function dedupeCycles(cycles: string[][]): string[][] {
  const seen = new Set<string>();
  return cycles.filter((cycle) => {
    const key = canonicalCycle(cycle);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function canonicalCycle(cycle: readonly string[]): string {
  const body = cycle.slice(0, -1);
  const rotations = body.map((_, index) => {
    const rotated = [...body.slice(index), ...body.slice(0, index)];
    return rotated.join("\0");
  });
  return [...rotations].sort()[0] ?? body.join("\0");
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
