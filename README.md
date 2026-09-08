# NodeForge

> An autonomous Node.js/TypeScript engineering workspace — orchestration core for VS Code and Cursor.

NodeForge is **not** an extension bundle. It is a control plane that wraps existing
engineering tools (TypeScript, ESLint, Biome, Prettier, Vitest, Jest, Prisma, Drizzle,
Docker, Git, etc.) behind a single normalized engineering model and exposes that model
both to the IDE (VS Code / Cursor) and to AI coding agents.

## Architectural principle

> NodeForge owns the orchestration, the normalized engineering state, the UI, and the
> agent interface. Existing tools remain the execution engines.

```
Existing tools (tsc / eslint / biome / vitest / jest / git / docker / prisma)
        │
        ▼
   Adapters            (packages/adapters/*)
        │
        ▼
   Contracts           (packages/contracts — Diagnostic, WorkspaceProfile, TestResult, …)
        │
        ▼
  NodeForge Core       (packages/core — detector, diagnostics aggregator, event bus)
        │
        ▼
   Runner              (packages/runner — cancellable process execution)
        │
   ┌────┴────┐
   ▼         ▼
 IDE UI    Agent Interface
(VS Code)   (MCP / context + tools)
```

### Dependency rule

- `vscode` API is isolated to `packages/extension`.
- Core domain packages (`contracts`, `core`, `runner`, `adapters`) MUST NOT import `vscode`.
- Adapters return normalized contracts — they never leak tool-specific shapes into the core.
- The runner centralizes process execution; no other package spawns processes directly.

## Repository layout

```
nodeforge/
├── packages/
│   ├── contracts/          # Normalized engineering contracts (no runtime deps)
│   ├── core/               # Workspace detection, diagnostic aggregation, event bus
│   ├── runner/             # Cancellable process execution
│   ├── adapters/           # TypeScript / ESLint / Biome / Vitest / Jest / Prisma / …
│   ├── extension/          # VS Code / Cursor extension shell
│   └── test-fixtures/      # Real miniature repositories for integration tests
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
├── tsconfig.base.json
├── CLAUDE.md
└── README.md
```

## Status

Phase 1:

- [x] pnpm monorepo
- [x] `packages/contracts` — full contract surface
- [x] `packages/core` — workspace detector (Node, TypeScript, package manager, linter, formatter, test runner, ORM, Docker, GitHub Actions, monorepo)
- [x] `packages/runner` — cancellable process runner with timeout, env isolation, streaming
- [x] `packages/extension` — VS Code extension shell with sidebar TreeView and `Analyze Workspace` command
- [x] Fixture repositories for integration tests
- [x] Unit tests passing for detector + runner

Phase 2:

- [x] `packages/adapters/typescript` — wraps `tsc --noEmit`, parses compiler output, normalizes to `Diagnostic[]`
- [x] `packages/adapters/eslint` — discovers `eslint.config.*`, runs local ESLint with `--format json`, normalizes to `Diagnostic[]`
- [x] `packages/core/diagnostics` — `DiagnosticStore` + `DiagnosticAggregator`, publishes `diagnostics.snapshot` events
- [x] Integration tests against real `tsc` / `eslint` runs on fixtures
- [x] 48 tests passing across the workspace

Phase 3:

- [x] `packages/adapters/biome` — wraps `biome ci --reporter=json`, parses NDJSON-style output, normalizes to `Diagnostic[]`
- [x] `packages/adapters/vitest` — wraps `vitest run --reporter=json`, normalizes to `TestSuite` / `TestRunResult`
- [x] `packages/adapters/jest` — wraps `jest --json`, normalizes to `TestSuite` / `TestRunResult`
- [x] Real fixtures with deliberate lint findings, passing tests, and failing tests
- [x] 80 tests passing across the workspace

Phase 4:

- [x] Live extension UI — `DiagnosticManager` orchestrates TS/ESLint/Biome adapters based on `WorkspaceProfile`, runs them on save (debounced), records results into the `DiagnosticStore`
- [x] `DiagnosticsViewProvider` renders real findings grouped by source with click-to-navigate
- [x] `TestManager` runs Vitest/Jest based on profile; `TestsViewProvider` renders the test tree with pass/fail icons
- [x] `nodeforge.runDiagnostics` and `nodeforge.runTests` commands with progress UI
- [x] `packages/core/runtime/ProcessManager` — long-lived process management with stdout/stderr streaming, runtime error detection, exit-code → diagnostic mapping
- [x] `packages/adapters/git` — detects branch, dirty state, ahead/behind, changed/staged files via `git status --porcelain=v2`
- [x] `RuntimeViewProvider` shows running processes with recent output
- [x] `GitViewProvider` shows branch/HEAD/upstream/changed-files/staged-files
- [x] `nodeforge.refreshGit` command + auto-detection on activation
- [x] 103 tests passing across the workspace

Upcoming milestones (see `CLAUDE.md`):

- Database adapters (Prisma, Drizzle schema introspection)
- Agent interface (MCP) — context + tools + repair loop
- Dependency intelligence (npm audit / OSV / outdated)
- Docker / Kubernetes / GitHub Actions deep integration

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## License

MIT
