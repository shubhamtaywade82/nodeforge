/**
 * Tests for the Prettier adapter.
 *
 * The adapter wraps `prettier --write` which modifies files — we test
 * `hasConfig` detection rather than running real formatting, since the
 * test fixtures don't have Prettier installed.
 */

import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { PrettierAdapter } from "../src/PrettierAdapter.js";

const ESLINT_FIXTURE = path.resolve(__dirname, "../../../test-fixtures/node-ts-eslint");

describe("PrettierAdapter", () => {
  it("hasConfig returns true for a workspace with .prettierrc.json", async () => {
    // The eslint fixture has .prettierrc.json
    expect(await PrettierAdapter.hasConfig(ESLINT_FIXTURE)).toBe(true);
  });

  it("hasConfig returns false for a workspace without Prettier config", async () => {
    // The parent directory (test-fixtures/) doesn't have Prettier
    expect(await PrettierAdapter.hasConfig(path.dirname(ESLINT_FIXTURE))).toBe(false);
  });
});
