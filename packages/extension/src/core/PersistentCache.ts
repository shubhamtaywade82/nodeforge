/**
 * Versioned, scoped, expiring cache on top of a VS Code Memento
 * (`workspaceState` / `globalState`). No `vscode` import.
 *
 * Anything unreadable — wrong version, other scope, expired, malformed — reads as a miss,
 * so a stale or corrupted entry can never break activation.
 */

export interface MementoLike {
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void>;
}

interface Envelope {
  readonly v: number;
  readonly scope: string;
  readonly savedAt: number;
  readonly data: unknown;
}

function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return typeof e["v"] === "number" && typeof e["scope"] === "string" && typeof e["savedAt"] === "number" && "data" in e;
}

export class PersistentCache<T> {
  private readonly memento: MementoLike;
  private readonly key: string;
  private readonly version: number;
  private readonly maxAgeMs: number;
  private readonly validate: (data: unknown) => data is T;
  private readonly now: () => number;

  constructor(
    memento: MementoLike,
    key: string,
    version: number,
    maxAgeMs: number,
    validate: (data: unknown) => data is T,
    now: () => number = Date.now
  ) {
    this.memento = memento;
    this.key = key;
    this.version = version;
    this.maxAgeMs = maxAgeMs;
    this.validate = validate;
    this.now = now;
  }

  /** `scope` is typically the workspace root so entries never leak across folders. */
  read(scope: string): T | undefined {
    const raw = this.memento.get(this.key);
    if (!isEnvelope(raw)) return undefined;
    if (raw.v !== this.version || raw.scope !== scope) return undefined;
    const age = this.now() - raw.savedAt;
    if (age < 0 || age > this.maxAgeMs) return undefined;
    return this.validate(raw.data) ? raw.data : undefined;
  }

  async write(scope: string, data: T): Promise<void> {
    const envelope: Envelope = { v: this.version, scope, savedAt: this.now(), data };
    await this.memento.update(this.key, envelope);
  }

  async clear(): Promise<void> {
    await this.memento.update(this.key, undefined);
  }
}
