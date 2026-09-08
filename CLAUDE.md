# NodeForge Engineering Rules

This document is the engineering contract for every contributor — human or AI agent
(Claude Code, Cursor, Copilot, etc.). Read it before touching the codebase.

## 1. Architecture

- The VS Code API is **isolated** in `packages/extension`. No other package may import `vscode`.
- Core domain packages (`contracts`, `core`, `runner`, `adapters/*`) MUST NOT import `vscode`.
- External tools (tsc, eslint, biome, vitest, jest, git, docker, prisma, …) are accessed **only** through adapters.
- Adapters return normalized contracts from `packages/contracts`. Tool-specific shapes never leak into core.
- Process execution is centralized in `packages/runner`. No other package spawns child processes directly.
- All commands MUST be cancellable (AbortSignal / cancellation token).
- All filesystem paths MUST be workspace-aware (resolve to a workspace root, never assume cwd).
- Trust-sensitive operations (running commands, starting processes, mutating databases, agent execution) require Workspace Trust. Read-only analysis may run in Restricted Mode.
- Every adapter requires fixture-based integration tests (see `packages/test-fixtures/`).
- VS Code API interactions are isolated behind small wrappers so they can be unit-tested without a real editor.

## 2. TypeScript

- `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`.
- No `any`. Prefer `unknown` and narrow explicitly.
- Explicit error types — throw `NodeForgeError` subclasses, not `Error` with a string.
- Exhaustive discriminated unions. Use `switch` with `never`-default checks when handling union variants.
- Prefer small interfaces and dependency inversion over concrete class imports.
- `type` for unions/aliases; `interface` for object shapes that may be extended.
- Pure functions in `contracts` and `core/detector/*` — no side effects, no I/O.

## 3. Testing

Every feature requires, at minimum:

1. **Unit tests** — for pure logic (parsers, detectors, normalizers).
2. **Integration tests** — for adapters that wrap external tools, run against fixture repositories.
3. **VS Code integration tests** — only where IDE behavior is involved (commands, views, diagnostics).

Fixture repositories live in `packages/test-fixtures/`. Each is a real miniature repo
with its own `package.json`, `tsconfig.json`, and config files. They are NOT workspace
packages (excluded in `pnpm-workspace.yaml`).

## 4. Process management

- The `ProcessRunner` is the single entry point for spawning child processes.
- Every `run()` accepts an optional `AbortSignal` and `timeoutMs`.
- Cancellation sends `SIGTERM`, waits `killGraceMs`, then `SIGKILL`.
- Capture stdout/stderr with bounded buffers — never let an unbounded stream OOM the extension host.
- Always pass an explicit `cwd`. Never inherit `process.env` blindly — merge with `process.env` explicitly when needed.

## 5. Diagnostics

- All diagnostics flow through `DiagnosticAggregator` → `DiagnosticStore` → VS Code `DiagnosticCollection`.
- Diagnostics are normalized to `contracts.Diagnostic` before publication.
- Each diagnostic carries `source`, `severity`, `file`, `line`, `column`, `message`, `fixable`.
- Source identifiers are stable strings: `"typescript" | "eslint" | "biome" | "prettier" | "test" | "runtime" | "security"`.

## 6. Workspace Trust

Capabilities matrix:

| Capability | Restricted Mode | Trusted Mode |
|---|---|---|
| Workspace inspection (read package.json, tsconfig, etc.) | ✓ | ✓ |
| Static configuration display | ✓ | ✓ |
| Diagnostics display (read-only) | ✓ | ✓ |
| Run arbitrary command | ✗ | ✓ |
| Start application / process | ✗ | ✓ |
| Run tests | ✗ | ✓ |
| Database mutations | ✗ | ✓ |
| Agent execution | ✗ | ✓ |

The extension declares `"untrustedWorkspaces": { "supported": "limited" }` in `package.json`.

## 7. Commit / release discipline

- Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `perf:`.
- Push to feature branches; PRs required for `main`.
- Version milestones tracked in `README.md` status section.

## 8. AI agent workflow

When working with Claude Code (or any coding agent):

- Give one vertical slice at a time. Never prompt "build NodeForge" wholesale.
- Slice template: implement contract → implement detector/adapter → add fixture → add unit test → add integration test → run full suite → show diff.
- Each slice must leave `pnpm typecheck && pnpm test` green.
- If the agent cannot make a slice pass, it must stop and report rather than disabling tests.

## 9. Roadmap milestones

```
v0.0.1  Extension shell                                  [done]
v0.0.2  Workspace detection                              [done]
v0.0.3  Process runner                                   [done]
v0.0.4  TypeScript adapter
v0.0.5  ESLint adapter
v0.0.6  Biome adapter
v0.0.7  Unified diagnostics UI
v0.0.8  Vitest adapter
v0.0.9  Jest adapter
v0.1.0  NodeForge Developer Core (alpha)
v0.1.1  Runtime engine
v0.1.2  Git intelligence
v0.1.3  Dependency intelligence
v0.1.4  Docker / CI
v0.2.0  Database integrations
v0.3.0  Agent context
v0.4.0  Agent tools
v0.5.0  Validation / repair loop
v1.0.0  Production release
```
