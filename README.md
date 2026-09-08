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

Phase 1 (this milestone):

- [x] pnpm monorepo
- [x] `packages/contracts` — full contract surface
- [x] `packages/core` — workspace detector (Node, TypeScript, package manager, linter, formatter, test runner, ORM, Docker, GitHub Actions, monorepo)
- [x] `packages/runner` — cancellable process runner with timeout, env isolation, streaming
- [x] `packages/extension` — VS Code extension shell with sidebar TreeView and `Analyze Workspace` command
- [x] Fixture repositories for integration tests
- [x] Unit tests passing for detector + runner

Upcoming milestones (see `CLAUDE.md`):

- TypeScript / ESLint / Biome adapters
- Unified diagnostic store
- Test adapters (Vitest, Jest, Node test)
- Runtime engine
- Git intelligence
- Database adapters
- Agent interface (MCP)

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## License

MIT
