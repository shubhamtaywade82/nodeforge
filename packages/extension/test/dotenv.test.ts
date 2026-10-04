import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseDotEnv } from "../src/core/dotenv.ts";

describe("parseDotEnv", () => {
  it("parses basic, export, quoted, CRLF and comments", () => {
    const env = parseDotEnv('A=1\r\n# c\nexport B="two words"\nC=\'x # y\'\nD=v # trailing\n\nbad line\n=novalue\n');
    assert.deepEqual(env, { A: "1", B: "two words", C: "x # y", D: "v" });
  });
  it("keeps '=' inside values and does not interpolate", () => {
    assert.deepEqual(parseDotEnv("URL=a=b&c=$HOME"), { URL: "a=b&c=$HOME" });
  });
});
