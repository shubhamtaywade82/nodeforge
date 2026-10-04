/**
 * Human-readable summary of an `applyPatch` request for the confirmation dialog.
 * Pure (no `vscode` import) and tolerant of malformed model input.
 */

export interface PatchEditInput {
  readonly path: string;
  readonly oldText: string;
  readonly newText: string;
}

const MAX_FILES_LISTED = 8;
const MAX_PREVIEW_CHARS = 240;

export function isPatchEdit(value: unknown): value is PatchEditInput {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["path"] === "string" && typeof v["oldText"] === "string" && typeof v["newText"] === "string";
}

/** A code fence long enough that the content cannot close it early. */
export function fenced(text: string): string {
  const longestRun = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}\n${text}\n${fence}`;
}

function preview(text: string): string {
  const flat = text.length > MAX_PREVIEW_CHARS ? `${text.slice(0, MAX_PREVIEW_CHARS)}…` : text;
  return fenced(flat);
}

export interface PatchSummary {
  readonly title: string;
  readonly markdown: string;
  readonly valid: boolean;
}

export function summarizePatch(input: unknown): PatchSummary {
  const edits = typeof input === "object" && input !== null ? (input as { edits?: unknown }).edits : undefined;
  if (!Array.isArray(edits) || edits.length === 0 || !edits.every(isPatchEdit)) {
    return {
      title: "Edit workspace files",
      markdown: "NodeForge wants to edit workspace files, but the request is malformed and will be rejected.",
      valid: false
    };
  }

  const byFile = new Map<string, { edits: number; creates: boolean }>();
  for (const edit of edits) {
    const entry = byFile.get(edit.path) ?? { edits: 0, creates: false };
    entry.edits++;
    if (edit.oldText === "") entry.creates = true;
    byFile.set(edit.path, entry);
  }

  const files = [...byFile.entries()];
  const lines = [
    `NodeForge wants to change **${files.length}** file${files.length === 1 ? "" : "s"} (${edits.length} edit${edits.length === 1 ? "" : "s"}):`,
    "",
    ...files.slice(0, MAX_FILES_LISTED).map(([p, e]) => `- \`${p.replace(/`/g, "'")}\` — ${e.creates ? "create new file" : `${e.edits} edit${e.edits === 1 ? "" : "s"}`}`),
    ...(files.length > MAX_FILES_LISTED ? [`- …and ${files.length - MAX_FILES_LISTED} more`] : [])
  ];

  const first = edits[0] as PatchEditInput;
  lines.push("", first.oldText === "" ? "First new file starts with:" : "First edit replaces:", preview(first.oldText === "" ? first.newText : first.oldText));
  if (first.oldText !== "") lines.push("with:", preview(first.newText));

  return {
    title: files.length === 1 && files[0] ? `Edit ${files[0][0]}` : `Edit ${files.length} files`,
    markdown: lines.join("\n"),
    valid: true
  };
}
