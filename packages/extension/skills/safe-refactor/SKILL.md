---
name: safe-refactor
description: Refactor Node.js and TypeScript incrementally using dependency impact, focused tests, and verification.
---

# Safe Refactoring

1. Inspect implementation, callers, dependencies, and tests.
2. Add or improve a regression test when behavior is at risk.
3. Change one cohesive concept at a time.
4. Preserve public behavior unless the task explicitly requires a breaking change.
5. Run focused verification after each meaningful behavior change.
6. Run format, typecheck, lint, and relevant integration tests before completion.
7. Review the final diff for accidental scope expansion.

Avoid big-bang rewrites, speculative abstractions, and unrelated cleanup.
