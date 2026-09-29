# @nodeforge/agent — MCP Server

NodeForge's Model Context Protocol (MCP) server. Exposes workspace intelligence
to AI coding agents (Cursor, Claude Code, etc.) via a standard JSON-RPC 2.0
interface over stdio.

## Quick start

### 1. Build the server

```bash
cd packages/agent
pnpm build
```

### 2. Configure in Cursor

Add to your Cursor MCP settings (`.cursor/mcp.json` or via Settings → MCP):

```json
{
  "mcpServers": {
    "nodeforge": {
      "command": "node",
      "args": ["/absolute/path/to/nodeforge/packages/agent/dist/cli.js"],
      "env": {
        "NODEFORGE_WORKSPACE_ROOT": "/absolute/path/to/your/project",
        "NODEFORGE_WORKSPACE_TRUSTED": "true",
        "NODEFORGE_ALLOW_EXECUTION": "true",
        "NODEFORGE_ALLOW_WRITES": "true",
        "NODEFORGE_ALLOW_NETWORK": "true"
      }
    }
  }
}
```

Restart Cursor. The NodeForge tools will appear in the agent's tool palette.

### 3. Use in agent conversations

Ask Cursor things like:

- "What does this project use? (runtime, linter, test runner, ORM)"
- "Run diagnostics and tell me what's broken"
- "Run the tests and summarize failures"
- "What's the database schema?"
- "Are there any known vulnerabilities in dependencies?"
- "What's the git state? Am I ahead of upstream?"

The agent will call the appropriate NodeForge MCP tool and get structured JSON
back — not terminal text.

## Available tools

| Tool | Description |
|------|-------------|
| `getProjectContext` | Returns the `WorkspaceProfile`: runtime, package manager, TypeScript, linter, formatter, test runner, ORM, Docker/K8s/GitHub Actions, monorepo kind. |
| `getDiagnostics` | Runs TypeScript + ESLint/Biome and returns all findings as a JSON array. Each finding has `source`, `severity`, `file`, `line`, `column`, `message`, `rule`, `fixable`. |
| `runTypeCheck` | Runs only `tsc --noEmit` and returns type errors. Faster than `getDiagnostics` when you only care about types. |
| `runLinter` | Runs only the linter (ESLint or Biome). Returns lint findings without type errors. |
| `getTestResults` | Runs the detected test runner (Vitest or Jest) and returns the test suite tree + run result with pass/fail counts, durations, and failure messages. |
| `runTests` | Alias for `getTestResults`. |
| `getGitState` | Returns branch, HEAD short hash, dirty status, changed files, staged files, upstream, ahead/behind. |
| `getDependencyReport` | Runs `npm audit` / `pnpm audit` + `outdated` and returns vulnerabilities (with severity, advisory IDs, recommended fixes) and outdated packages. |
| `getDatabaseSchema` | Detects the database schema (Prisma or Drizzle) and returns tables, columns, indexes, and relations. |

## Architecture

```
Cursor / MCP Client
        │
        ▼ (JSON-RPC 2.0 over stdio)
  nodeforge-mcp (cli.js)
        │
        ▼
  McpServer
        │
        ├── initialize        → server info + capabilities
        ├── tools/list        → tool definitions
        └── tools/call        → dispatch to handler
                │
                ▼
          NodeForgeContext
                │
        ┌───────┼───────────────────┐
        ▼       ▼                   ▼
  detectWorkspaceProfile  TypescriptAdapter  EslintAdapter
                         BiomeAdapter       VitestAdapter
                         JestAdapter        GitAdapter
                         PrismaAdapter      DrizzleAdapter
                         DependencyAdapter
```

The MCP server is **stateless** across tool calls — each `tools/call` runs the
relevant adapter fresh. This keeps the server simple (no caching, no
invalidation) at the cost of repeated work. A future version can add caching
with file-watch invalidation.

## Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODEFORGE_WORKSPACE_ROOT` | Absolute workspace root. | `process.cwd()` |
| `NODEFORGE_WORKSPACE_TRUSTED` | Explicit trust assertion for standalone MCP execution. | `false` |
| `NODEFORGE_ALLOW_EXECUTION` | Enables tools that execute project-controlled code. | `false` |
| `NODEFORGE_ALLOW_WRITES` | Enables workspace-mutating tools. Requires execution + trust. | `false` |
| `NODEFORGE_ALLOW_NETWORK` | Enables network-dependent tools such as dependency audit. | `false` |

The standalone MCP server is fail-closed. Static inspection tools are available by default;
execution, writes, and network access require explicit opt-in. Treat `runScript` as arbitrary
project-controlled code execution.

## Protocol

The server currently advertises MCP protocol version `2024-11-05` with:

- **Tools**: `listChanged: false` (static tool list)
- **Resources**: config-file resources via `resources/list` + `resources/read`
- **Prompts**: pre-built workflows via `prompts/list` + `prompts/get`
- **Subscriptions**: not implemented

Future versions can add tool result caching with file-watch invalidation and additional engineering workflows.

## Development

```bash
# Run tests (uses the node-ts-with-errors fixture for real adapter runs)
pnpm test

# Typecheck
pnpm typecheck

# Build
pnpm build

# Run the server manually for debugging
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | NODEFORGE_WORKSPACE_ROOT=/path/to/project node dist/cli.js
```
