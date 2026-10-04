# NodeForge

> Node.js/TypeScript project analysis and agent-assisted remediation for VS Code and Cursor.

NodeForge detects your project's tooling, runs it through normalized adapters, and gives AI agents
a policy-gated set of tools (read/search/patch source, diagnostics, tests, git, dependencies). It is
**not** an extension bundle. It is a control plane that wraps existing
engineering tools (TypeScript, ESLint, Biome, Prettier, Vitest, Jest, Node test runner, Prisma, Drizzle,
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
        ▼
  Tool Runner + Policy Engine
        │
   ┌────┴─────┐
   ▼          ▼
 IDE UI     Agent Interface
(VS Code)   (MCP / Chat / LM tools)
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
├── docs/                   # Documentation, guides, architecture rules, changelog
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
- [x] Automated test coverage for the workspace

Phase 3:

- [x] `packages/adapters/biome` — wraps `biome ci --reporter=json`, parses NDJSON-style output, normalizes to `Diagnostic[]`
- [x] `packages/adapters/vitest` — wraps `vitest run --reporter=json`, normalizes to `TestSuite` / `TestRunResult`
- [x] `packages/adapters/jest` — wraps `jest --json`, normalizes to `TestSuite` / `TestRunResult`
- [x] Real fixtures with deliberate lint findings, passing tests, and failing tests
- [x] Automated test coverage for the workspace

Phase 4:

- [x] Live extension UI — `DiagnosticManager` orchestrates TS/ESLint/Biome adapters based on `WorkspaceProfile`, runs them on save (debounced), records results into the `DiagnosticStore`
- [x] `DiagnosticsViewProvider` renders real findings grouped by source with click-to-navigate
- [x] `TestManager` runs the detected Vitest/Jest/Node test runner; native Test Explorer renders nested suites with Run/Debug profiles
- [x] `nodeforge.runDiagnostics` and `nodeforge.runTests` commands with progress UI
- [x] `packages/core/runtime/ProcessManager` — long-lived process management with stdout/stderr streaming, runtime error detection, exit-code → diagnostic mapping
- [x] `packages/adapters/git` — detects branch, dirty state, ahead/behind, changed/staged files via `git status --porcelain=v2`
- [x] `RuntimeViewProvider` shows running processes with recent output
- [x] `GitViewProvider` shows branch/HEAD/upstream/changed-files/staged-files
- [x] `nodeforge.refreshGit` command + auto-detection on activation
- [x] Automated test coverage for the workspace

Phase 5:

- [x] `packages/adapters/prisma` — parses `prisma/schema.prisma` into `DatabaseSchema` (models, enums, relations, @@index/@@unique/@@map, @default, @relation)
- [x] `packages/adapters/drizzle` — parses Drizzle ORM schema files (pgTable/mysqlTable/sqliteTable, pgEnum, type helpers, modifiers)
- [x] `packages/adapters/dependencies` — wraps `npm audit --json` / `pnpm audit --json` / `yarn audit --json` and `npm outdated --json`, normalizes to `DependencyFinding[]`
- [x] `DatabaseManager` orchestrates Prisma/Drizzle based on profile.orm
- [x] `DependencyManager` runs audit + outdated based on profile.packageManager
- [x] `DatabaseViewProvider` renders schema tree (tables → columns + indexes + relations)
- [x] `DependencyViewProvider` renders vulnerabilities + outdated packages with severity breakdown
- [x] `nodeforge.detectDatabase` and `nodeforge.auditDependencies` commands
- [x] Auto-detects database schema on activation when ORM is present
- [x] Automated test coverage for the workspace

Phase 6:

- [x] `packages/agent` — MCP server (JSON-RPC 2.0 over stdio) with 9 tools:
  `getProjectContext`, `getDiagnostics`, `runTypeCheck`, `runLinter`,
  `getTestResults`, `runTests`, `getGitState`, `getDependencyReport`,
  `getDatabaseSchema`
- [x] `NodeForgeContext` — re-uses all adapters to read workspace state on demand
- [x] Standalone CLI entry point (`nodeforge-mcp`) that Cursor/Claude Code can spawn
- [x] `AgentViewProvider` in the extension sidebar shows MCP server status + tool reference
- [x] Full Cursor MCP config documentation in `packages/agent/README.md`
- [x] Automated test coverage for the workspace

Phase 7:

- [x] `packages/adapters/docker` — parses Dockerfile (FROM/WORKDIR/ENV/EXPOSE/COPY/CMD/HEALTHCHECK,
  multi-stage builds) and docker-compose.yml (services/ports/volumes/networks/depends_on/healthcheck)
- [x] `packages/adapters/kubernetes` — parses k8s manifests (Deployment/Service/ConfigMap/Secret/
  Ingress) with containers, ports, env vars (incl. secret/configmap refs), resources, probes
- [x] `packages/adapters/github-actions` — parses .github/workflows/*.yml (triggers including
  push/pull_request/schedule/workflow_dispatch, jobs, steps, matrix, env, concurrency, permissions)
- [x] 3 new MCP tools: `getDockerConfig`, `getKubernetesManifests`, `getGitHubWorkflows` (12 total)
- [x] Real fixture repo with Dockerfile, docker-compose.yml, k8s/ manifests, .github/workflows/
- [x] Automated test coverage for the workspace

Phase 8:

- [x] `packages/adapters/dependency-graph` — builds import graph from source files, detects
  unused dependencies (declared but never imported), circular dependencies (import cycles),
  and missing dependencies (imported but not declared)
- [x] Handles `.js` → `.ts` extension mapping (standard ESM convention)
- [x] False-positive detection for CLI tools / config plugins / `@types/*` packages
- [x] DFS-based circular dependency detection among file nodes
- [x] 1 new MCP tool: `getDependencyGraph` (13 total)
- [x] Real fixture with deliberate unused dep (`lodash`) and circular chain (`a → b → c → a`)
- [x] Automated test coverage for the workspace

Phase 9:

- [x] `packages/adapters/prettier` — wraps `prettier --write` for file formatting
- [x] ESLint adapter gains `fix()` method (runs `eslint --fix`)
- [x] Biome adapter gains `format()` method (runs `biome format --write`)
- [x] 4 new MCP action tools (18 total):
  - `runScript` — runs `npm/pnpm/yarn run <script>` from package.json
  - `formatFiles` — runs Prettier or Biome formatter with `--write`
  - `applyEslintFix` — runs ESLint with `--fix` to auto-fix lint issues
  - `validateWorkspace` — combined typecheck + lint + tests + audit report
- [x] Action tools are centrally classified as read, execute, or write; mutating operations require explicit authorization
- [x] Automated test coverage for the workspace

Phase 10:

- [x] MCP resources — `resources/list` + `resources/read` expose an explicit
  allowlist of engineering configuration files; arbitrary workspace files and
  secret-bearing files such as `.env` are not exposed
- [x] MCP prompts — 6 engineering workflow prompts with argument substitution:
  `fix-lint-errors`, `audit-and-upgrade-deps`, `validate-and-fix`,
  `onboard-to-project`, `add-test-for`, `explain-errors`
- [x] Extension packaged as installable .vsix (36.99 KB) via `vsce package`
- [x] Full INSTALL.md guide covering extension install + MCP server config
- [x] End-to-end verified: initialize returns tools + resources + prompts capabilities

Phase 11:

- [x] Central tool authorization policy shared by MCP, built-in chat, and native VS Code language-model tools
- [x] Standalone MCP execution is fail-closed with explicit trust, execution, write, and network capabilities
- [x] Interactive approval for built-in chat workspace writes and package-script execution
- [x] Runtime tool argument validation rejects unknown, missing, and invalid values
- [x] Canonical path containment blocks traversal and symlink/junction escapes
- [x] MCP resource allowlist prevents arbitrary file and secret-file reads
- [x] Prompt-injection boundary explicitly treats repository content and tool output as untrusted data
- [x] Security model, Dependabot configuration, and capability-aware installation docs added

## Documentation

| Doc | Description |
| ----- | ------------- |
| **[docs/extension-user-guide.md](./docs/extension-user-guide.md)** | Full guide for the VS Code / Cursor extension |
| **[docs/devdocs.md](./docs/devdocs.md)** | DevDocs.io integration in the sidebar |
| **[docs/README.md](./docs/README.md)** | Documentation index |
| **[docs/INSTALL.md](./docs/INSTALL.md)** | Install `.vsix`, optional MCP |
| **[docs/TESTING.md](./docs/TESTING.md)** | Manual QA checklists |
| **[docs/SECURITY.md](./docs/SECURITY.md)** | Security model, trust boundaries, and MCP capability controls |
| **[docs/security-and-privacy.md](./docs/security-and-privacy.md)** | Built-in chat, Ollama, prompt-injection, and model data flow |
| **[packages/extension/README.md](./packages/extension/README.md)** | Extension package + F5 dev loop |

## Installation

See **[docs/INSTALL.md](./docs/INSTALL.md)** for step-by-step instructions on:

- Installing the VS Code / Cursor extension from .vsix
- Configuring the MCP agent server in Cursor
- Using all 21 MCP tools, 6 prompts, and config file resources

Quick install:

```bash
code --install-extension packages/extension/nodeforge-0.1.0.vsix
```

Quick MCP config (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "nodeforge": {
      "command": "node",
      "args": ["~/projects/developer-tools/nodeforge/packages/agent/dist/cli.js"],
      "env": {
        "NODEFORGE_WORKSPACE_ROOT": "~/projects/developer-tools/nodeforge",
        "NODEFORGE_WORKSPACE_TRUSTED": "true",
        "NODEFORGE_ALLOW_EXECUTION": "true",
        "NODEFORGE_ALLOW_WRITES": "true",
        "NODEFORGE_ALLOW_NETWORK": "true"
      }
    }
  }
}
```

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

### Workspaces and trust

- **Multi-root:** NodeForge operates on one *active* folder (default: the first; change it with
  `NodeForge: Select Workspace Folder`). Agent tools never reach outside the active folder.
- **Restricted Mode:** inspection, read/search of source and read-only reports work; running
  commands, tests, processes, patching, the MCP server and the terminal profile require Workspace Trust.

## License

MIT


## Repository quality gates

NodeForge enforces the same baseline checks locally and in CI:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm package
```

The test suite includes real VS Code extension-host integration suites (`host`, `trusted`, `multiroot`, `untrusted`) under `packages/extension-vscode-tests`. They launch the extension against the included fixtures using Microsoft's VS Code Test CLI. The test runner uses a stable VS Code desktop build in CI.


### Release artifact verification

NodeForge's release workflow generates a SHA-256 checksum and a GitHub artifact attestation for the VSIX. Verify a downloaded release with:

```bash
sha256sum -c nodeforge-<version>.vsix.sha256
gh attestation verify nodeforge-<version>.vsix --repo shubhamtaywade82/nodeforge
```
