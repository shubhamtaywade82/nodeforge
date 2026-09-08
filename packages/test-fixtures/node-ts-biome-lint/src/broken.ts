/**
 * Source file with deliberate Biome lint findings.
 *
 * Expected diagnostics (with the rules configured in biome.json):
 *   - noExplicitAny (error) — `any` type annotation
 *   - useImportType (warn)   — value import that should be type-only
 *   - useConst (error)      — `let` that is never reassigned
 *   - noConsoleLog (warn)    — `console.log` call
 *   - noUnusedVariables (warn) — unused binding
 */

// value import of a type — should trigger useImportType
import { SomeType } from "./types.js";

let neverReassigned = 1; // should be `const`

export function process(input: any): any { // noExplicitAny x2
  const unused = "never read"; // noUnusedVariables
  console.log(neverReassigned, unused); // noConsoleLog
  return input;
}

export type { SomeType };
