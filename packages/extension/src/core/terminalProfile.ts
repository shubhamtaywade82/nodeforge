/** Pure options for the "NodeForge" integrated-terminal profile. No `vscode` import. */

export interface NodeForgeTerminalOptions {
  readonly name: string;
  readonly cwd: string;
  readonly env: Record<string, string>;
}

export function terminalProfileOptions(root: string): NodeForgeTerminalOptions {
  if (!root) throw new Error("A workspace root is required for the NodeForge terminal profile.");
  return { name: "NodeForge", cwd: root, env: { NODEFORGE_WORKSPACE_ROOT: root } };
}
