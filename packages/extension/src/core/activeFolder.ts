/** Pure active-folder resolution for multi-root workspaces. No VS Code imports. */

export interface FolderRef {
  readonly name: string;
  readonly fsPath: string;
}

/**
 * The active folder is the explicit selection while it is still part of the workspace,
 * otherwise the first folder. Returns undefined when no folders are open.
 */
export function resolveActiveFolder(
  folders: readonly FolderRef[],
  selectedPath: string | undefined
): FolderRef | undefined {
  if (selectedPath) {
    const hit = folders.find((f) => f.fsPath === selectedPath);
    if (hit) return hit;
  }
  return folders[0];
}

/** Folder that contains `filePath` (deepest match), used to follow the active editor. */
export function folderContaining(folders: readonly FolderRef[], filePath: string, sep: string): FolderRef | undefined {
  let best: FolderRef | undefined;
  for (const f of folders) {
    const prefix = f.fsPath.endsWith(sep) ? f.fsPath : f.fsPath + sep;
    if (filePath === f.fsPath || filePath.startsWith(prefix)) {
      if (!best || f.fsPath.length > best.fsPath.length) best = f;
    }
  }
  return best;
}
