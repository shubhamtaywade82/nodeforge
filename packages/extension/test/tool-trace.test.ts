import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_RESULT_CHARS,
  MAX_ROUNDS_KEPT,
  MAX_TRACE_CHARS,
  REPLAY_NOTE,
  boundTrace,
  buildHistory,
  makeRound,
  parseToolTrace,
  truncateText
} from "../src/ai/toolTrace.ts";

const round = (id: string, text = "ok") => makeRound([{ callId: id, name: "nodeforge_get_project_context", input: {} }], { [id]: text });

describe("makeRound / truncateText", () => {
  it("pairs each call with exactly one result and bounds large results", () => {
    const r = makeRound(
      [{ callId: "a", name: "x", input: { p: 1 } }, { callId: "b", name: "y", input: [1] }],
      { a: "z".repeat(MAX_RESULT_CHARS + 500) }
    );
    assert.equal(r.results.length, 2);
    assert.equal(r.results[0]?.truncated, true);
    assert.ok((r.results[0]?.text.length ?? 0) < MAX_RESULT_CHARS + 100);
    assert.equal(r.results[1]?.text, "");
    assert.deepEqual(r.calls[1]?.input, {}, "non-object input is normalized to {}");
  });

  it("does not truncate short text", () => {
    assert.deepEqual(truncateText("abc", 10), { text: "abc", truncated: false });
  });
});

describe("boundTrace", () => {
  it("keeps recent rounds within the round and size budgets and counts what it dropped", () => {
    const many = Array.from({ length: 20 }, (_, i) => round(`c${i}`));
    const t = boundTrace(many);
    assert.ok(t.rounds.length <= MAX_ROUNDS_KEPT);
    assert.equal(t.droppedRounds, 20 - t.rounds.length);
    assert.equal(t.rounds.at(-1)?.calls[0]?.callId, "c19", "the newest round is kept");

    const big = Array.from({ length: 6 }, (_, i) => round(`b${i}`, "q".repeat(MAX_RESULT_CHARS)));
    const bt = boundTrace(big);
    assert.ok(JSON.stringify(bt.rounds).length <= MAX_TRACE_CHARS + 2000);
    assert.ok(bt.droppedRounds > 0);
  });

  it("always keeps at least the newest round, even if it alone exceeds the budget", () => {
    const t = boundTrace([round("only", "w".repeat(MAX_RESULT_CHARS))]);
    assert.equal(t.rounds.length, 1);
    assert.equal(t.droppedRounds, 0);
  });
});

describe("parseToolTrace (untrusted metadata)", () => {
  it("round-trips a bounded trace", () => {
    const t = boundTrace([round("a"), round("b")]);
    assert.deepEqual(parseToolTrace({ toolTrace: JSON.parse(JSON.stringify(t)) }), t);
  });

  it("rejects malformed, mismatched or foreign metadata", () => {
    const good = JSON.parse(JSON.stringify(boundTrace([round("a")]))) as Record<string, unknown>;
    for (const bad of [
      undefined,
      null,
      "x",
      {},
      { toolTrace: null },
      { toolTrace: { v: 2, rounds: [] } },
      { toolTrace: { ...good, rounds: "x" } },
      { toolTrace: { v: 1, rounds: [{ calls: [{ callId: "a", name: "n", input: {} }], results: [] }] } },
      { toolTrace: { v: 1, rounds: [{ calls: [{ callId: "a", name: "n", input: {} }], results: [{ callId: "zzz", text: "t" }] }] } },
      { toolTrace: { v: 1, rounds: [{ calls: [{ callId: 1, name: "n", input: {} }], results: [{ callId: "1", text: "t" }] }] } },
      { toolTrace: { v: 1, rounds: [{ calls: [{ callId: "a", name: "n", input: [] }], results: [{ callId: "a", text: "t" }] }] } },
      { toolTrace: { v: 1, rounds: [{ calls: [], results: [] }] } }
    ]) {
      assert.equal(parseToolTrace(bad), undefined, JSON.stringify(bad));
    }
  });
});

describe("buildHistory", () => {
  const trace = boundTrace([round("c1", '{"runtime":"node"}')]);

  it("replays tool calls and results as structured messages, marked as earlier evidence", () => {
    const h = buildHistory(
      [
        { kind: "request", prompt: "what is this project?" },
        { kind: "response", text: "It is a Node project.", trace }
      ],
      6
    );
    assert.deepEqual(h.map((m) => m.role), ["user", "assistant", "user", "assistant"]);
    assert.equal(h[1]?.parts[0]?.kind, "toolCall");
    const result = h[2]?.parts[0];
    assert.equal(result?.kind, "toolResult");
    assert.ok(result?.kind === "toolResult" && result.text.startsWith(REPLAY_NOTE) && result.text.includes("node"));
    assert.deepEqual(h[3]?.parts, [{ kind: "text", text: "It is a Node project." }]);
  });

  it("every replayed tool result follows an assistant message that made the matching call", () => {
    const h = buildHistory([{ kind: "response", text: "", trace: boundTrace([round("a"), round("b")]) }], 6);
    for (let i = 0; i < h.length; i++) {
      const m = h[i];
      if (m?.parts[0]?.kind === "toolResult") {
        const prev = h[i - 1];
        const ids = prev?.parts.flatMap((p) => (p.kind === "toolCall" ? [p.callId] : [])) ?? [];
        for (const p of m.parts) assert.ok(p.kind === "toolResult" && ids.includes(p.callId));
      }
    }
  });

  it("limits to the most recent turns and skips empty ones", () => {
    const turns = Array.from({ length: 10 }, (_, i) => ({ kind: "request" as const, prompt: `q${i}` }));
    assert.equal(buildHistory(turns, 3).length, 3);
    assert.deepEqual(buildHistory([{ kind: "request", prompt: "" }, { kind: "response", text: "" }], 6), []);
  });

  it("notes when earlier rounds were dropped", () => {
    const h = buildHistory([{ kind: "response", text: "done", trace: boundTrace(Array.from({ length: 10 }, (_, i) => round(`d${i}`))) }], 6);
    assert.match(JSON.stringify(h[0]), /earlier tool round/);
  });

  it("works for responses without a trace (plain text, as before)", () => {
    assert.deepEqual(buildHistory([{ kind: "response", text: "hi" }], 6), [{ role: "assistant", parts: [{ kind: "text", text: "hi" }] }]);
  });
});
