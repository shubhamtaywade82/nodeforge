/**
 * Dependency graph contracts — produced by `packages/adapters/dependency-graph`.
 *
 * Represents the import graph of a Node.js/TypeScript project: which source
 * files import which packages, which dependencies are declared but never
 * imported (unused), and which packages form circular dependency chains.
 */

/**
 * A node in the dependency graph — represents either a source file or an
 * external package.
 */
export interface DependencyGraphNode {
  /** Node id — either a file path or a package name. */
  id: string;
  /** Node type. */
  kind: "file" | "package";
  /** Display name. */
  name: string;
  /** For file nodes: absolute path. For package nodes: the package name. */
  path?: string;
  /** Whether this is an external (node_modules) package. */
  isExternal: boolean;
}

/**
 * A directed edge: `from` imports `from`.
 */
export interface DependencyGraphEdge {
  /** Source file that does the importing. */
  from: string;
  /** Target: either a file path or a package name. */
  to: string;
  /** Import kind. */
  kind: "static" | "dynamic" | "type";
  /** The original import specifier, e.g. "./foo" or "lodash". */
  specifier: string;
}

/**
 * The full dependency graph.
 */
export interface DependencyGraph {
  /** Root directory the graph was built from. */
  root: string;
  /** All nodes (files + packages). */
  nodes: DependencyGraphNode[];
  /** All edges (import relationships). */
  edges: DependencyGraphEdge[];
  /** Packages declared in package.json (prod + dev). */
  declaredPackages: Array<{
    name: string;
    version: string;
    dependencyType: "prod" | "dev" | "optional" | "peer";
  }>;
}

/**
 * A dependency that is declared in package.json but never imported.
 */
export interface UnusedDependency {
  /** Package name. */
  packageName: string;
  /** Declared version range. */
  version: string;
  /** Where it was declared. */
  dependencyType: "prod" | "dev" | "optional" | "peer";
  /**
   * Whether this package is likely a false positive — some packages are
   * used without being imported (e.g. `typescript`, `eslint`, `prettier`,
   * `@types/*`, CLI tools referenced in scripts).
   */
  likelyFalsePositive: boolean;
  /** Reason for the false-positive flag, if applicable. */
  falsePositiveReason?: string;
}

/**
 * A circular dependency chain: A → B → C → A.
 */
export interface CircularDependency {
  /** The chain of nodes forming the cycle. */
  chain: string[];
  /** Cycle length (number of edges). */
  length: number;
}

/**
 * Combined dependency graph analysis.
 */
export interface DependencyGraphAnalysis {
  /** The full graph. */
  graph: DependencyGraph;
  /** Unused dependencies (declared but never imported). */
  unused: UnusedDependency[];
  /** Circular dependencies (import cycles). */
  circular: CircularDependency[];
  /** Packages imported but not declared in package.json (missing deps). */
  missing: Array<{
    packageName: string;
    importedBy: string[];
  }>;
}
