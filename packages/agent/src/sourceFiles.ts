/**
 * Workspace source access for agents: bounded reads, bounded search, atomic exact-match edits.
 *
 * Every path is contained to the workspace root (lexically and through symlinks) and checked
 * against a deny list so secrets, VCS internals and dependency trees are never returned or edited.
 */

import * as path from "node:path";
import { lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { resolveContainedPath } from "./safePath.js";

export const MAX_READ_BYTES = 200_000;
export const MAX_EDIT_FILE_BYTES = 1_000_000;
export const MAX_SEARCH_FILE_BYTES = 1_000_000;
export const MAX_SEARCH_FILES = 5_000;
export const MAX_SEARCH_RESULTS = 100;
export const MAX_SNIPPET_CHARS = 300;
export const MAX_EDITS = 50;
export const MAX_PATTERN_CHARS = 200;

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  ".git", "node_modules", "dist", "build", "out", "coverage", ".next", ".nuxt", ".turbo", ".cache", ".pnpm-store", ".vscode-test"
]);

const SECRET_FILE_PATTERNS: readonly RegExp[] = [
  /^\.env(?:\..*)?$/i,
  /^\.npmrc$/i,
  /^\.netrc$/i,
  /^\.pypirc$/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i,
  /\.(?:pem|key|p12|pfx|jks|keystore)$/i,
  /^credentials(?:\.json)?$/i,
  /^secrets?\.(?:json|ya?ml|toml)$/i
];

export type SourceAccessError =
  | "PATH_OUTSIDE_WORKSPACE"
  | "PATH_DENIED"
  | "NOT_FOUND"
  | "NOT_A_FILE"
  | "BINARY_FILE"
  | "TOO_LARGE"
  | "INVALID_ARGUMENT"
  | "EDIT_FAILED";

export class SourceAccessDeniedError extends Error {
  readonly code: SourceAccessError;
  constructor(code: SourceAccessError, message: string) {
    super(message);
    this.name = "SourceAccessDeniedError";
    this.code = code;
  }
}

/** Returns a reason when the workspace-relative path must not be read or written. */
export function denyReason(relativePath: string): string | undefined {
  const segments = relativePath.split(/[\\/]+/).filter(Boolean);
  for (const segment of segments.slice(0, -1)) {
    if (segment === ".git" || segment === "node_modules") return `"${segment}" directories are not accessible.`;
  }
  const name = segments.at(-1) ?? "";
  if (name === ".git" || name === "node_modules") return `"${name}" is not accessible.`;
  if (SECRET_FILE_PATTERNS.some((p) => p.test(name))) return `"${name}" may contain secrets and is not accessible.`;
  return undefined;
}

function toRelative(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join("/");
}

async function resolveExistingFile(root: string, requested: string): Promise<{ absolute: string; relative: string }> {
  if (typeof requested !== "string" || requested.trim() === "") {
    throw new SourceAccessDeniedError("INVALID_ARGUMENT", "A file path is required.");
  }
  const lexicalDenied = denyReason(path.normalize(requested));
  if (lexicalDenied) throw new SourceAccessDeniedError("PATH_DENIED", lexicalDenied);

  const absolute = await resolveContainedPath(root, requested);
  if (!absolute) {
    throw new SourceAccessDeniedError("PATH_OUTSIDE_WORKSPACE", `"${requested}" does not exist inside the workspace.`);
  }
  const relative = toRelative(await realRoot(root), absolute);
  const denied = denyReason(relative);
  if (denied) throw new SourceAccessDeniedError("PATH_DENIED", denied);

  const info = await lstat(absolute);
  if (!info.isFile()) throw new SourceAccessDeniedError("NOT_A_FILE", `"${requested}" is not a regular file.`);
  return { absolute, relative };
}

async function realRoot(root: string): Promise<string> {
  const { realpath } = await import("node:fs/promises");
  return realpath(root);
}

async function looksBinary(absolute: string): Promise<boolean> {
  const handle = await open(absolute, "r");
  try {
    const buffer = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}

// ─── readFile ───

export interface ReadFileOptions {
  /** 1-based, inclusive. */
  readonly startLine?: number;
  readonly endLine?: number;
}

export interface ReadFileResult {
  readonly path: string;
  readonly content: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly totalLines: number;
  readonly truncated: boolean;
}

export async function readSourceFile(root: string, requested: string, options: ReadFileOptions = {}): Promise<ReadFileResult> {
  const { absolute, relative } = await resolveExistingFile(root, requested);
  if (await looksBinary(absolute)) throw new SourceAccessDeniedError("BINARY_FILE", `"${relative}" is a binary file.`);

  const info = await lstat(absolute);
  if (info.size > MAX_EDIT_FILE_BYTES * 5 && options.startLine === undefined) {
    throw new SourceAccessDeniedError("TOO_LARGE", `"${relative}" is ${info.size} bytes; request a line range.`);
  }

  const lines = (await readFile(absolute, "utf8")).split("\n");
  if (lines.at(-1) === "") lines.pop();
  const totalLines = lines.length;

  const start = Math.max(1, Math.trunc(options.startLine ?? 1));
  const requestedEnd = Math.trunc(options.endLine ?? totalLines);
  if (!Number.isFinite(start) || !Number.isFinite(requestedEnd) || requestedEnd < start) {
    throw new SourceAccessDeniedError("INVALID_ARGUMENT", "endLine must be greater than or equal to startLine.");
  }
  const end = Math.min(totalLines, requestedEnd);

  let content = lines.slice(start - 1, end).join("\n");
  let truncated = false;
  let effectiveEnd = end;
  if (Buffer.byteLength(content, "utf8") > MAX_READ_BYTES) {
    truncated = true;
    const kept: string[] = [];
    let bytes = 0;
    for (const line of lines.slice(start - 1, end)) {
      bytes += Buffer.byteLength(line, "utf8") + 1;
      if (bytes > MAX_READ_BYTES) break;
      kept.push(line);
    }
    content = kept.join("\n");
    effectiveEnd = start + kept.length - 1;
  }
  return { path: relative, content, startLine: start, endLine: effectiveEnd, totalLines, truncated };
}

// ─── searchCode ───

export interface SearchOptions {
  readonly regex?: boolean;
  readonly caseSensitive?: boolean;
  /** Only search files whose workspace-relative path ends with one of these (e.g. ".ts"). */
  readonly extensions?: readonly string[];
  readonly maxResults?: number;
}

export interface SearchMatch {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export interface SearchResult {
  readonly query: string;
  readonly matches: SearchMatch[];
  readonly filesScanned: number;
  readonly truncated: boolean;
}

export async function searchSourceCode(root: string, query: string, options: SearchOptions = {}): Promise<SearchResult> {
  if (typeof query !== "string" || query.length === 0) {
    throw new SourceAccessDeniedError("INVALID_ARGUMENT", "A non-empty query is required.");
  }
  if (query.length > MAX_PATTERN_CHARS) {
    throw new SourceAccessDeniedError("INVALID_ARGUMENT", `Query is longer than ${MAX_PATTERN_CHARS} characters.`);
  }

  const flags = options.caseSensitive ? "" : "i";
  let matcher: (line: string) => boolean;
  if (options.regex) {
    let re: RegExp;
    try {
      re = new RegExp(query, flags);
    } catch (error) {
      throw new SourceAccessDeniedError("INVALID_ARGUMENT", `Invalid regular expression: ${(error as Error).message}`);
    }
    matcher = (line) => re.test(line);
  } else {
    const needle = options.caseSensitive ? query : query.toLowerCase();
    matcher = (line) => (options.caseSensitive ? line : line.toLowerCase()).includes(needle);
  }

  const maxResults = Math.min(MAX_SEARCH_RESULTS, Math.max(1, Math.trunc(options.maxResults ?? 50)));
  const extensions = (options.extensions ?? []).map((e) => (e.startsWith(".") ? e : `.${e}`).toLowerCase());
  const matches: SearchMatch[] = [];
  let filesScanned = 0;
  let truncated = false;

  const base = await realRoot(root);

  async function walk(directory: string): Promise<void> {
    if (truncated) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (truncated) return;
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue; // never follow links out of the workspace
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;

      const relative = toRelative(base, full);
      if (denyReason(relative)) continue;
      if (extensions.length > 0 && !extensions.includes(path.extname(entry.name).toLowerCase())) continue;
      if (filesScanned >= MAX_SEARCH_FILES) {
        truncated = true;
        return;
      }
      const info = await lstat(full);
      if (info.size > MAX_SEARCH_FILE_BYTES) continue;
      if (await looksBinary(full)) continue;
      filesScanned++;

      const lines = (await readFile(full, "utf8")).split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        // Bound per-line work so a pathological regex cannot stall on a minified bundle.
        const candidate = line.length > 2000 ? line.slice(0, 2000) : line;
        if (matcher(candidate)) {
          matches.push({ path: relative, line: i + 1, text: candidate.trim().slice(0, MAX_SNIPPET_CHARS) });
          if (matches.length >= maxResults) {
            truncated = true;
            return;
          }
        }
      }
    }
  }

  await walk(base);
  return { query, matches, filesScanned, truncated };
}

// ─── applyPatch ───

export interface PatchEdit {
  readonly path: string;
  /** Exact text to replace; must occur exactly once. Empty string creates a new file. */
  readonly oldText: string;
  readonly newText: string;
}

export interface PatchFileSummary {
  readonly path: string;
  readonly created: boolean;
  readonly editsApplied: number;
  readonly linesBefore: number;
  readonly linesAfter: number;
}

export interface PatchResult {
  readonly ok: boolean;
  readonly files: PatchFileSummary[];
  readonly error?: string;
}

async function ancestorIsContained(base: string, target: string): Promise<boolean> {
  const relative = path.relative(base, target);
  if (relative === "" || relative.startsWith(".." + path.sep) || relative === ".." || path.isAbsolute(relative)) return false;

  let current = path.dirname(target);
  for (;;) {
    const exists = await lstat(current).then(() => true, () => false);
    if (exists) {
      if (current === base) return true;
      const canonical = await resolveContainedPath(base, path.relative(base, current));
      return canonical !== undefined;
    }
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function lineCount(text: string): number {
  if (text === "") return 0;
  const n = text.split("\n").length;
  return text.endsWith("\n") ? n - 1 : n;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) return count;
    count++;
    from = index + needle.length;
  }
}

export function parseEdits(raw: unknown): PatchEdit[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new SourceAccessDeniedError("INVALID_ARGUMENT", "edits must be a non-empty array.");
  }
  if (raw.length > MAX_EDITS) {
    throw new SourceAccessDeniedError("INVALID_ARGUMENT", `At most ${MAX_EDITS} edits are allowed per call.`);
  }
  return raw.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new SourceAccessDeniedError("INVALID_ARGUMENT", `edits[${index}] must be an object.`);
    }
    const { path: p, oldText, newText } = item as Record<string, unknown>;
    if (typeof p !== "string" || p.trim() === "") {
      throw new SourceAccessDeniedError("INVALID_ARGUMENT", `edits[${index}].path must be a non-empty string.`);
    }
    if (typeof oldText !== "string" || typeof newText !== "string") {
      throw new SourceAccessDeniedError("INVALID_ARGUMENT", `edits[${index}].oldText and newText must be strings.`);
    }
    if (oldText === newText) {
      throw new SourceAccessDeniedError("INVALID_ARGUMENT", `edits[${index}] changes nothing (oldText equals newText).`);
    }
    return { path: p, oldText, newText };
  });
}

interface PlannedFile {
  readonly absolute: string;
  readonly relative: string;
  readonly created: boolean;
  readonly before: string;
  after: string;
  edits: number;
}

/**
 * Applies exact-match edits atomically: every edit is validated against the in-memory result of the
 * previous ones first; nothing is written unless all edits (across all files) are valid.
 */
export async function applySourcePatch(root: string, rawEdits: unknown): Promise<PatchResult> {
  const edits = parseEdits(rawEdits);
  const base = await realRoot(root);
  const planned = new Map<string, PlannedFile>();

  for (const [index, edit] of edits.entries()) {
    const label = `edits[${index}] (${edit.path})`;
    const lexicalDenied = denyReason(path.normalize(edit.path));
    if (lexicalDenied) throw new SourceAccessDeniedError("PATH_DENIED", `${label}: ${lexicalDenied}`);

    let file = planned.get(path.resolve(base, edit.path));
    if (!file) {
      if (edit.oldText === "") {
        // Creating a file: the nearest existing ancestor must be inside the workspace. Everything
        // below it does not exist yet, so it cannot be a symlink out of the workspace.
        const target = path.resolve(base, edit.path);
        if (!(await ancestorIsContained(base, target))) {
          throw new SourceAccessDeniedError("PATH_OUTSIDE_WORKSPACE", `${label}: the target is outside the workspace.`);
        }
        const relative = toRelative(base, target);
        const denied = denyReason(relative);
        if (denied) throw new SourceAccessDeniedError("PATH_DENIED", `${label}: ${denied}`);
        const exists = await lstat(target).then(() => true, () => false);
        if (exists) {
          throw new SourceAccessDeniedError("EDIT_FAILED", `${label}: the file already exists; supply oldText to edit it.`);
        }
        file = { absolute: target, relative, created: true, before: "", after: "", edits: 0 };
      } else {
        const resolved = await resolveExistingFile(base, edit.path).catch((error: unknown) => {
          if (error instanceof SourceAccessDeniedError) {
            throw new SourceAccessDeniedError(error.code, `${label}: ${error.message}`);
          }
          throw error;
        });
        if (await looksBinary(resolved.absolute)) {
          throw new SourceAccessDeniedError("BINARY_FILE", `${label}: binary files cannot be edited.`);
        }
        const info = await lstat(resolved.absolute);
        if (info.size > MAX_EDIT_FILE_BYTES) {
          throw new SourceAccessDeniedError("TOO_LARGE", `${label}: file is larger than ${MAX_EDIT_FILE_BYTES} bytes.`);
        }
        const before = await readFile(resolved.absolute, "utf8");
        file = { absolute: resolved.absolute, relative: resolved.relative, created: false, before, after: before, edits: 0 };
      }
      planned.set(path.resolve(base, edit.path), file);
    }

    if (edit.oldText === "") {
      if (!file.created || file.edits > 0) {
        throw new SourceAccessDeniedError("EDIT_FAILED", `${label}: an empty oldText is only valid as the first edit of a new file.`);
      }
      file.after = edit.newText;
    } else {
      // Files with CRLF line endings: accept LF text from the model and keep the file's style.
      const crlf = file.after.includes("\r\n") && !edit.oldText.includes("\r\n");
      const oldText = crlf ? edit.oldText.replace(/\r?\n/g, "\r\n") : edit.oldText;
      const newText = crlf ? edit.newText.replace(/\r?\n/g, "\r\n") : edit.newText;
      const occurrences = countOccurrences(file.after, oldText);
      if (occurrences === 0) {
        throw new SourceAccessDeniedError("EDIT_FAILED", `${label}: oldText was not found. Read the file again and copy the text exactly, including whitespace.`);
      }
      if (occurrences > 1) {
        throw new SourceAccessDeniedError("EDIT_FAILED", `${label}: oldText occurs ${occurrences} times; include more surrounding context so it is unique.`);
      }
      file.after = file.after.replace(oldText, () => newText);
    }
    file.edits++;
    if (Buffer.byteLength(file.after, "utf8") > MAX_EDIT_FILE_BYTES) {
      throw new SourceAccessDeniedError("TOO_LARGE", `${label}: result would exceed ${MAX_EDIT_FILE_BYTES} bytes.`);
    }
  }

  // All edits are valid: write via temp file + rename so a crash never leaves a half-written file.
  const written: PlannedFile[] = [];
  try {
    for (const file of planned.values()) {
      if (file.created) await mkdir(path.dirname(file.absolute), { recursive: true });
      const temp = `${file.absolute}.nodeforge-${process.pid}-${Date.now()}.tmp`;
      await writeFile(temp, file.after, { encoding: "utf8", flag: "wx" });
      try {
        await rename(temp, file.absolute);
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
      written.push(file);
    }
  } catch (error) {
    // Roll back files already replaced so the patch stays all-or-nothing.
    for (const file of written) {
      if (file.created) await rm(file.absolute, { force: true });
      else await writeFile(file.absolute, file.before, "utf8");
    }
    throw new SourceAccessDeniedError("EDIT_FAILED", `Writing failed and was rolled back: ${(error as Error).message}`);
  }

  return {
    ok: true,
    files: [...planned.values()].map((f) => ({
      path: f.relative,
      created: f.created,
      editsApplied: f.edits,
      linesBefore: lineCount(f.before),
      linesAfter: lineCount(f.after)
    }))
  };
}
