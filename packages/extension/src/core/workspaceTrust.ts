import * as vscode from "vscode";

/**
 * Single source of truth for Workspace Trust. Fails closed: anything other than an
 * explicit `true` is treated as Restricted Mode.
 */
export function isWorkspaceTrusted(): boolean {
  return vscode.workspace.isTrusted === true;
}
