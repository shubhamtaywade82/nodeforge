---
name: clean-node-typescript
description: Write and review clean modern Node.js and TypeScript with strict type safety, simple design, and production-grade error handling.
---

# Clean Node.js + TypeScript

Use this skill when implementing, reviewing, or refactoring Node.js or TypeScript.

- Establish the project's actual runtime, TypeScript version, module system, package manager, linter, formatter, and test runner before changing conventions.
- Prefer local project conventions over global style preferences.
- Favor small functions, cohesive modules, explicit boundaries, and strong types.
- Use platform APIs before adding dependencies.
- Do not abstract until reuse or a real boundary justifies it.
- Separate pure transformations from side effects.
- Use unknown at untrusted boundaries and narrow it.
- Propagate cancellation and preserve deterministic cleanup for long-running operations.
- Prefer straightforward async/await when it improves readability.
- Optimize only when measurements or a concrete bottleneck justify it.
