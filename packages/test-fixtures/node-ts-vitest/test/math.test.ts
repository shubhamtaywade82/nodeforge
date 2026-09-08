import { describe, it, expect } from "vitest";
import { add, divide } from "../src/math.js";

describe("add", () => {
  it("adds two positive numbers", () => {
    expect(add(2, 3)).toBe(5);
  });

  it("handles negative numbers", () => {
    expect(add(-1, -2)).toBe(-3);
  });

  it("handles zero", () => {
    expect(add(0, 0)).toBe(0);
  });
});

describe("divide", () => {
  it("divides correctly", () => {
    expect(divide(10, 2)).toBe(5);
  });

  it("throws on division by zero", () => {
    expect(() => divide(1, 0)).toThrow("Cannot divide by zero");
  });

  // This test is intentionally broken — used to exercise the failure path.
  it("intentionally failing assertion", () => {
    expect(add(1, 1)).toBe(3); // 2 !== 3
  });
});
