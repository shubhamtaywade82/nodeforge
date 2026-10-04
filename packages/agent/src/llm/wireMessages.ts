import type { LlmMessage } from "./types.js";

type WireContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type WireMessage = Omit<LlmMessage, "images" | "content"> & {
  content: string | null | WireContentPart[];
};

/**
 * Converts internal messages to the OpenAI-compatible wire format. Messages without
 * images are sent unchanged; images become `image_url` content parts after the text.
 */
export function toWireMessages(messages: readonly LlmMessage[]): WireMessage[] {
  return messages.map((message) => {
    const { images, ...rest } = message;
    if (!images || images.length === 0) return rest;
    if (message.role !== "user") {
      throw new Error(`Images can only be attached to user messages, not "${message.role}".`);
    }
    const parts: WireContentPart[] = [];
    if (message.content) parts.push({ type: "text", text: message.content });
    for (const url of images) parts.push({ type: "image_url", image_url: { url } });
    return { ...rest, content: parts };
  });
}
