/**
 * Pure builders for NodeForge's launch.json-style debug configurations.
 * No `vscode` import. Nothing here may resolve a tool through `npx`/the network:
 * a missing dependency must fail loudly instead of being downloaded and executed.
 */

export interface PackageJsonDeps {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

export function hasDependency(pkg: PackageJsonDeps | undefined, name: string): boolean {
  return Boolean(pkg?.dependencies?.[name] ?? pkg?.devDependencies?.[name]);
}

export interface CurrentTsFileConfig {
  readonly name: string;
  readonly type: "node";
  readonly request: "launch";
  readonly runtimeExecutable: "node";
  readonly runtimeArgs: string[];
  readonly program: string;
  readonly cwd: string;
  readonly console: "integratedTerminal";
  readonly skipFiles: string[];
  readonly env: Record<string, string>;
}

/**
 * Debug the active TypeScript file with the project's own `tsx` when declared,
 * otherwise with Node's built-in type stripping (Node 22.6+; the flag is a no-op on newer
 * versions where it is the default). Never `npx`.
 */
export function buildCurrentTsFileConfig(pkg: PackageJsonDeps | undefined): CurrentTsFileConfig {
  const useTsx = hasDependency(pkg, "tsx");
  return {
    name: useTsx ? "Debug: Current TS File (tsx)" : "Debug: Current TS File (Node type stripping)",
    type: "node",
    request: "launch",
    runtimeExecutable: "node",
    runtimeArgs: useTsx ? ["--import", "tsx"] : ["--experimental-strip-types"],
    program: "${file}",
    cwd: "${workspaceFolder}",
    console: "integratedTerminal",
    skipFiles: ["<node_internals>/**", "${workspaceFolder}/node_modules/**"],
    env: {}
  };
}
