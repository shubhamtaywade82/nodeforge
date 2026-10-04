import * as path from "node:path";
import { realpath } from "node:fs/promises";

/**
 * Resolve a workspace-relative path while preventing lexical traversal and
 * symlink/junction escape from the workspace's canonical root.
 */
export async function resolveContainedPath(
  workspaceRoot: string,
  requestedPath: string
): Promise<string | undefined> {
  const lexicalCandidate = path.resolve(workspaceRoot, requestedPath);
  const lexicalRelative = path.relative(workspaceRoot, lexicalCandidate);

  if (
    lexicalRelative === "" ||
    lexicalRelative.startsWith(".." + path.sep) ||
    path.isAbsolute(lexicalRelative)
  ) {
    return undefined;
  }

  let canonicalRoot: string;
  let canonicalTarget: string;

  try {
    [canonicalRoot, canonicalTarget] = await Promise.all([
      realpath(workspaceRoot),
      realpath(lexicalCandidate)
    ]);
  } catch {
    return undefined;
  }

  const canonicalRelative = path.relative(canonicalRoot, canonicalTarget);
  if (
    canonicalRelative === "" ||
    canonicalRelative.startsWith(".." + path.sep) ||
    path.isAbsolute(canonicalRelative)
  ) {
    return undefined;
  }

  return canonicalTarget;
}
