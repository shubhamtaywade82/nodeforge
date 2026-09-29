import { add } from "../src/index.js";

describe("fixture", () => {
  it("runs a real Jest test through NodeForge", () => {
    expect(add(2, 3)).toBe(5);
  });
});
