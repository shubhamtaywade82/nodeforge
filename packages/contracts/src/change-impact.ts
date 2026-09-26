/**
 * Change-impact analysis for a set of source files.
 */
export interface ChangeImpact {
  /** Workspace-relative files considered changed. */
  files: string[];
  /** Files imported directly by the changed files. */
  directDependencies: string[];
  /** Files reachable downstream from the changed files. */
  transitiveDependencies: string[];
  /** Files that directly import one of the changed files. */
  directDependents: string[];
  /** Files transitively affected by the changed files. */
  transitiveDependents: string[];
  /** External packages imported by changed or affected files. */
  externalPackages: string[];
  /** Circular dependency chains touching any changed file. */
  touchedCircularDependencies: string[][];
}
