/**
 * Structured memory of tool calls across chat turns.
 *
 * VS Code only hands a participant the visible text of earlier turns, so tool evidence would be
 * lost and the model would re-run the same tools every turn. The participant stores a bounded
 * trace in each response's `ChatResult.metadata` and replays it as real tool-call/result messages.
 *
 * Pure (no `vscode` import).
 */

export interface TracedCall {
  readonly callId: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

export interface TracedResult {
  readonly callId: string;
  readonly text: string;
  readonly truncated: boolean;
}

export interface TraceRound {
  readonly calls: readonly TracedCall[];
  readonly results: readonly TracedResult[];
}

export interface ToolTrace {
  readonly v: 1;
  readonly rounds: readonly TraceRound[];
  /** Older rounds omitted to stay within the size budget. */
  readonly droppedRounds: number;
}

export const MAX_RESULT_CHARS = 4_000;
export const MAX_TRACE_CHARS = 16_000;
export const MAX_ROUNDS_KEPT = 6;

export const REPLAY_NOTE = "[Result from an earlier turn; re-run the tool if the workspace may have changed.]\n";

export function truncateText(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: `${text.slice(0, max)}\n…[truncated ${text.length - max} characters]`, truncated: true };
}

export function makeRound(
  calls: ReadonlyArray<{ callId: string; name: string; input: unknown }>,
  resultTexts: Readonly<Record<string, string>>
): TraceRound {
  return {
    calls: calls.map((c) => ({
      callId: c.callId,
      name: c.name,
      input: typeof c.input === "object" && c.input !== null && !Array.isArray(c.input) ? (c.input as Record<string, unknown>) : {}
    })),
    results: calls.map((c) => {
      const { text, truncated } = truncateText(resultTexts[c.callId] ?? "", MAX_RESULT_CHARS);
      return { callId: c.callId, text, truncated };
    })
  };
}

function roundSize(round: TraceRound): number {
  return JSON.stringify(round).length;
}

/** Keeps the most recent rounds that fit the budget. */
export function boundTrace(rounds: readonly TraceRound[]): ToolTrace {
  const kept: TraceRound[] = [];
  let size = 0;
  for (let i = rounds.length - 1; i >= 0 && kept.length < MAX_ROUNDS_KEPT; i--) {
    const round = rounds[i] as TraceRound;
    const roundChars = roundSize(round);
    if (kept.length > 0 && size + roundChars > MAX_TRACE_CHARS) break;
    kept.unshift(round);
    size += roundChars;
  }
  return { v: 1, rounds: kept, droppedRounds: rounds.length - kept.length };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Strictly validates untrusted metadata read back from chat history. */
export function parseToolTrace(metadata: unknown): ToolTrace | undefined {
  if (!isRecord(metadata)) return undefined;
  const raw = metadata["toolTrace"];
  if (!isRecord(raw) || raw["v"] !== 1 || !Array.isArray(raw["rounds"])) return undefined;

  const rounds: TraceRound[] = [];
  for (const r of raw["rounds"].slice(0, MAX_ROUNDS_KEPT)) {
    if (!isRecord(r) || !Array.isArray(r["calls"]) || !Array.isArray(r["results"])) return undefined;
    const calls: TracedCall[] = [];
    for (const c of r["calls"]) {
      if (!isRecord(c) || typeof c["callId"] !== "string" || typeof c["name"] !== "string" || !isRecord(c["input"])) return undefined;
      calls.push({ callId: c["callId"], name: c["name"], input: c["input"] });
    }
    const results: TracedResult[] = [];
    for (const res of r["results"]) {
      if (!isRecord(res) || typeof res["callId"] !== "string" || typeof res["text"] !== "string") return undefined;
      results.push({ callId: res["callId"], text: res["text"].slice(0, MAX_RESULT_CHARS + 100), truncated: res["truncated"] === true });
    }
    // Every call needs exactly one result, otherwise replaying it would produce an invalid conversation.
    if (calls.length === 0 || calls.some((c) => results.filter((x) => x.callId === c.callId).length !== 1)) return undefined;
    rounds.push({ calls, results });
  }
  const dropped = typeof raw["droppedRounds"] === "number" && raw["droppedRounds"] >= 0 ? Math.trunc(raw["droppedRounds"]) : 0;
  return { v: 1, rounds, droppedRounds: dropped };
}

// ─── Replay ───

export type NeutralPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "toolCall"; readonly callId: string; readonly name: string; readonly input: Record<string, unknown> }
  | { readonly kind: "toolResult"; readonly callId: string; readonly text: string };

export interface NeutralMessage {
  readonly role: "user" | "assistant";
  readonly parts: readonly NeutralPart[];
}

export type HistoryTurn =
  | { readonly kind: "request"; readonly prompt: string }
  | { readonly kind: "response"; readonly text: string; readonly trace?: ToolTrace | undefined };

/** Rebuilds the model-facing conversation from the last `maxTurns` turns, with tool evidence. */
export function buildHistory(turns: readonly HistoryTurn[], maxTurns: number): NeutralMessage[] {
  const out: NeutralMessage[] = [];
  for (const turn of turns.slice(-maxTurns)) {
    if (turn.kind === "request") {
      if (turn.prompt) out.push({ role: "user", parts: [{ kind: "text", text: turn.prompt }] });
      continue;
    }
    if (turn.trace) {
      if (turn.trace.droppedRounds > 0) {
        out.push({
          role: "user",
          parts: [{ kind: "text", text: `[${turn.trace.droppedRounds} earlier tool round(s) in this turn are not shown.]` }]
        });
      }
      for (const round of turn.trace.rounds) {
        out.push({ role: "assistant", parts: round.calls.map((c) => ({ kind: "toolCall" as const, callId: c.callId, name: c.name, input: c.input })) });
        out.push({
          role: "user",
          parts: round.results.map((r) => ({ kind: "toolResult" as const, callId: r.callId, text: REPLAY_NOTE + r.text }))
        });
      }
    }
    if (turn.text) out.push({ role: "assistant", parts: [{ kind: "text", text: turn.text }] });
  }
  return out;
}
