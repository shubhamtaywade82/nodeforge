/** Tools that mutate the workspace or run arbitrary scripts. */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "runScript",
  "formatFiles",
  "applyEslintFix",
  "validateWorkspace"
]);

export function isWriteTool(toolName: string): boolean {
  return WRITE_TOOL_NAMES.has(toolName);
}
