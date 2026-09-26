---
name: NodeForge Node.js + TypeScript Engineering Standards
description: Modern, correct, maintainable Node.js and TypeScript standards for engineering assistance.
applyTo: "**/*.{ts,tsx,js,jsx}"
---

# NodeForge Engineering Standards

## Type safety

- Keep TypeScript strict.
- Prefer precise domain types over generic records or any.
- Treat external input as unknown until validated.
- Prefer discriminated unions for meaningful state.
- Handle missing values explicitly rather than suppressing the type system.
- Preserve readonly where mutation is unnecessary.

## Modern syntax

- Use ESM and modern module syntax when the project supports it.
- Prefer modern language and platform features only when supported by the project's actual Node.js and TypeScript versions.
- Prefer standard Node.js APIs over a dependency when the platform already provides a stable solution.
- Do not update syntax solely because a newer feature exists.

## Node.js correctness

- Prefer asynchronous filesystem and process APIs in application paths.
- Use AbortSignal for cancellable work when supported.
- Prefer argument arrays and process execution APIs over shell-string interpolation.
- Preserve process cleanup and useful error causes.
- Do not swallow errors unless the operation is intentionally best-effort and documented.

## Maintainability

- Keep modules cohesive and interfaces small.
- Prefer composition over inheritance unless polymorphism is real.
- Extract abstractions when a repeated concept, boundary, or variation justifies them.
- Avoid speculative refactoring and unrelated formatting churn.

## Verification

For behavior changes:

1. Add or improve a regression test.
2. Make the smallest implementation change.
3. Run focused tests.
4. Run typecheck and lint for affected packages.
5. Run broader validation when integration boundaries are affected.
