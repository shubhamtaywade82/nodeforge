/**
 * Source file with deliberate TypeScript AND ESLint errors.
 *
 * TypeScript errors (with `strict`, `noUnusedLocals`, `noUnusedParameters`):
 *   - line 18: TS2304 — Cannot find name 'undefinedVariable'.
 *   - line 21: TS6133 — 'unusedParam' is declared but its value is never read.
 *   - line 26: TS2322 — Type 'string' is not assignable to type 'number'.
 *
 * ESLint findings (recommended config):
 *   - line 18: no-undef — 'undefinedVariable' is not defined.
 *   - line 24: no-unused-vars — 'unused' is defined but never used.
 *   - line 31: no-empty — empty block.
 */

export function add(a: number, b: number): number {
  return a + b;
}

export function risky(a: number): number {
  // TS2304 + eslint no-undef
  return a + undefinedVariable;
}

export function withUnusedParam(unusedParam: string): number {
  return 42;
}

export function badAssign(): number {
  const unused = "I am never read"; // eslint no-unused-vars
  const x: number = "not a number"; // TS2322
  return x;
}

export function emptyCatch(): void {
  try {
    risky(1);
  } catch {
    // empty block — eslint no-empty
  }
}
