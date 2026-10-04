import { describe, expect, it } from "vitest";
import { toWireMessages } from "../src/llm/wireMessages.js";

describe("toWireMessages", () => {
  it("passes plain messages through unchanged", () => {
    const messages = [
      { role: "user" as const, content: "hi" },
      { role: "assistant" as const, content: null, tool_calls: [{ id: "1", type: "function" as const, function: { name: "a", arguments: "{}" } }] }
    ];
    expect(toWireMessages(messages)).toEqual(messages);
  });

  it("turns images into image_url parts after the text and drops the internal field", () => {
    const [wire] = toWireMessages([{ role: "user", content: "what is this?", images: ["data:image/png;base64,AAAA"] }]);
    expect(wire).toEqual({
      role: "user",
      content: [
        { type: "text", text: "what is this?" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }
      ]
    });
    expect(wire).not.toHaveProperty("images");
  });

  it("supports image-only messages", () => {
    const [wire] = toWireMessages([{ role: "user", content: null, images: ["data:image/jpeg;base64,BBBB"] }]);
    expect(wire?.content).toEqual([{ type: "image_url", image_url: { url: "data:image/jpeg;base64,BBBB" } }]);
  });

  it("rejects images on non-user messages", () => {
    expect(() => toWireMessages([{ role: "assistant", content: "x", images: ["data:image/png;base64,A"] }])).toThrow(/user messages/);
  });
});
