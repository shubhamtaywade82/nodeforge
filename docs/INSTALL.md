# NodeForge — Local Installation Guide

This guide walks you through installing the NodeForge VS Code extension and
configuring the MCP agent server for Cursor.

## Prerequisites

- **Node.js** 20+ (check with `node --version`)
- **pnpm** 9+ (install with `npm install -g pnpm` or `corepack enable`)
- **VS Code** 1.138+ or **Cursor** (any recent version)
- **git** (for the Git adapter)
- **Your project's dev dependencies installed** (`npm install` or `pnpm install`
  in your project root — NodeForge runs your project's own `tsc`, `eslint`,
  `vitest`, etc.)

## Part 1: Install the VS Code Extension

### Step 1: Build, Package, and Install (One-Liner)

From the repository root:

```bash
# Build, package, and install into both VS Code and Cursor:
pnpm run install:local
```

Or run step-by-step:

```bash
# 1. Install dependencies and build all packages
pnpm install
pnpm run compile

# 2. Package the extension VSIX to root nodeforge.vsix
pnpm run vsce-package

# 3. Install into Cursor and/or VS Code
code --install-extension nodeforge.vsix --force
cursor --install-extension nodeforge.vsix --force
```

#### Via Editor UI
1. Open VS Code or Cursor.
2. Open Extensions (`Ctrl+Shift+X` / `Cmd+Shift+X`).
3. Click the Views & More Actions menu (`...`) at the top of the Extensions view.
4. Select **Install from VSIX...**
5. Select `nodeforge-0.1.0.vsix`.
6. Reload the window: press `Ctrl+Shift+P` → run **Developer: Reload Window**.

### Step 3: Prepare Your Target Project

NodeForge executes your project's local tools (`tsc`, `eslint`, `vitest`, `jest`, etc.). Before testing or opening your target project, ensure its dependencies are installed:

```bash
# Example using the included all-in-one fixture:
cd /home/nemesis/projects/developer-tools/nodeforge/packages/test-fixtures/node-ts-eslint
npm install
```

Then open it in your editor:
```bash
cursor /home/nemesis/projects/developer-tools/nodeforge/packages/test-fixtures/node-ts-eslint
# or: code /home/nemesis/projects/developer-tools/nodeforge/packages/test-fixtures/node-ts-eslint
```

When prompted by the editor, click **Trust Folder & Workspace** to allow NodeForge adapters to run.

### Alternative: Run in Development Mode (F5)

To develop or debug NodeForge itself without packaging:

```bash
cd /home/nemesis/projects/developer-tools/nodeforge
pnpm install
pnpm build
```

1. Open the `/home/nemesis/projects/developer-tools/nodeforge` folder in VS Code / Cursor.
2. Open `packages/extension/src/extension.ts`.
3. Press `F5` to launch an Extension Development Host window with NodeForge pre-loaded.

## Part 2: Using the Extension

For the full feature reference (commands, settings, chat, trust model, limitations), see **[docs/extension-user-guide.md](./docs/extension-user-guide.md)**.

Once installed, open any Node.js/TypeScript project. The NodeForge sidebar
will appear in the Activity Bar on the left with 10 views:

| View | What it shows |
| ------ | --------------- |
| **Workspace** | Detected runtime, package manager, linter, formatter, test runner, ORM, Docker, CI |
| **Diagnostics** | Live TypeScript + ESLint/Biome findings (auto-refreshes on save) |
| **Tests** | Test suite tree with pass/fail icons (run via `NodeForge: Run Tests` command) |
| **Runtime** | Running dev/watch processes with recent output |
| **Git** | Branch, dirty status, changed/staged files |
| **Database** | Schema tree (tables, columns, indexes, relations) — if Prisma or Drizzle is detected |
| **Dependencies** | Vulnerabilities, outdated packages, unused/circular/missing deps |
| **Chat** | Built-in NodeForge AI assistant (OpenAI-compatible API) |
| **Docs** | DevDocs.io documentation (embedded; see [docs/devdocs.md](./docs/devdocs.md)) |
| **Agent** | MCP server status + tool reference (optional external agents) |

### Built-in Chat (no Cursor/Copilot required)

1. Run **`NodeForge: Set Chat API Key`** and paste an OpenAI-compatible API key
   (stored in VS Code Secret Storage).
2. Open the **Chat** view in the NodeForge sidebar (or **`NodeForge: Open Chat`**).
3. Ask questions or use workflow chips / slash commands:
   - `/audit-and-upgrade-deps`, `/validate-and-fix`, `/onboard-to-project`, `/explain-errors`

The chat uses the same engineering tool layer as the MCP server. Workspace writes
and package-script execution require explicit confirmation and are blocked in
Restricted Mode.

Configure the model and API base URL under **Settings → NodeForge → Chat**.

### Native Ollama provider

NodeForge also registers **NodeForge Ollama** as a native VS Code language-model provider. Set `nodeforge.ollama.baseUrl` (default: `http://localhost:11434`) and start Ollama. Models available from the server are discovered through Ollama's model APIs; capability metadata is used to advertise tool calling and vision support to VS Code.

For local Ollama, no account key is required. Ollama's OpenAI-compatible interface accepts the placeholder API key `ollama`. Cloud or authenticated custom endpoints can use `OLLAMA_API_KEY` in the extension host environment.

On activation (trusted workspaces), NodeForge can automatically run a dependency
**audit** and **graph analysis** — toggle under **Settings → NodeForge → Dependencies**
(`backgroundAudit`, `backgroundGraphAnalysis`).

### Commands (`Ctrl+Shift+P` / `Cmd+Shift+P`)

- `NodeForge: Analyze Workspace` — re-detect the workspace profile
- `NodeForge: Run Diagnostics` — run TypeScript + ESLint/Biome
- `NodeForge: Run Tests` — run the detected Vitest, Jest, or Node test runner
- `NodeForge: Refresh Git State` — re-detect git state
- `NodeForge: Detect Database Schema` — parse Prisma or Drizzle schema
- `NodeForge: Audit Dependencies` — run `npm audit` + `outdated`
- `NodeForge: Analyze Dependency Graph` — unused, circular, and missing dependencies
- `NodeForge: Set Chat API Key` — store API key for built-in chat
- `NodeForge: Open Chat` — focus the Chat sidebar
- `NodeForge: Clear Chat` — reset chat history
- `NodeForge: Open DevDocs Home` / **Search DevDocs** / **Open DevDocs for Workspace**
- `NodeForge: Sync DevDocs Offline` — download docsets for offline search (see [docs/devdocs.md](./docs/devdocs.md))
- `NodeForge: Refresh` — refresh all views

### Workspace Trust

NodeForge respects VS Code's Workspace Trust model:

- **Restricted Mode**: workspace detection runs (read-only), but no adapters
  execute. The sidebar shows the profile but diagnostics are empty.
- **Trusted Mode** (default for projects you own): full functionality —
  adapters run on save, tests run on demand, runtime processes can start.

## Part 3: Configure the MCP Agent Server (optional)

The built-in **Chat** view does not require MCP. Use this section only if you
want **external** agents (Claude Code, another Cursor MCP client, etc.) to call
the same tools.

The MCP server lets those agents read your workspace's structured state and take
actions via 21 tools.

### Step 1: Build the MCP server

```bash
cd /home/nemesis/projects/developer-tools/nodeforge/packages/agent
pnpm build
```

This produces `dist/cli.js` — the MCP server entry point.

### Step 2: Configure Cursor

Create or edit `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "nodeforge": {
      "command": "node",
      "args": ["/home/nemesis/projects/developer-tools/nodeforge/packages/agent/dist/cli.js"],
      "env": {
        "NODEFORGE_WORKSPACE_ROOT": "/home/nemesis/projects/developer-tools/nodeforge/packages/test-fixtures/node-ts-eslint",
        "NODEFORGE_WORKSPACE_TRUSTED": "true",
        "NODEFORGE_ALLOW_EXECUTION": "true",
        "NODEFORGE_ALLOW_WRITES": "true",
        "NODEFORGE_ALLOW_NETWORK": "true"
      }
    }
  }
}
```

Replace `NODEFORGE_WORKSPACE_ROOT` with your target project's path if testing another repository.

### Step 3: Restart Cursor

After saving the config, restart Cursor (or reload the window). The
NodeForge MCP server will appear in Cursor's MCP settings with a green
"connected" status.

### Step 4: Use in agent conversations

Now you can ask Cursor things like:

- "What does this project use?"
- "Run diagnostics and tell me what's broken"
- "Run the tests and summarize failures"
- "What's the database schema?"
- "Are there any known vulnerabilities?"
- "Fix all auto-fixable lint errors"
- "Validate the workspace and fix any issues"
- "Onboard me to this project"

The agent will call the appropriate NodeForge MCP tools and get structured
JSON back. Standalone MCP execution is fail-closed; the environment variables
above explicitly grant trust, execution, write, and network capabilities.

### Available MCP Tools (18 total)

**Read-only repository state:**

- `getProjectContext` — workspace profile
- `getGitState` — branch, dirty status, changed files
- `getGitDiff` — working, staged, or HEAD-vs-upstream patch
- `getDatabaseSchema` — Prisma or Drizzle schema
- `getDockerConfig` — Dockerfile + docker-compose
- `getKubernetesManifests` — Kubernetes resources
- `getGitHubWorkflows` — CI/CD workflows
- `getDependencyGraph` — unused + circular + missing dependencies

**Execution / analysis tools:**

- `getDiagnostics` — TypeScript + ESLint/Biome findings
- `runTypeCheck` — TypeScript compiler errors only
- `runLinter` — ESLint or Biome findings only
- `getTestResults` / `runTests` — test suite + run result
- `getDependencyReport` — vulnerability/outdated dependency report
- `validateWorkspace` — combined typecheck + lint + tests + audit

**Write / code-execution tools:**

- `runScript` — run an existing package.json script
- `formatFiles` — format workspace files with Prettier or Biome
- `applyEslintFix` — run ESLint with `--fix`

Execution tools are trust-gated. Workspace mutations and package-script execution are
explicitly approval-gated in built-in NodeForge chat; standalone MCP uses environment
capabilities to fail closed by default.

**MCP Resources:** Config files (package.json, tsconfig.json, eslint.config,
Dockerfile, etc.) are exposed as MCP resources — the agent can read them
without running tools.

**MCP Prompts (6):**

- `fix-lint-errors` — auto-fix lint + suggest manual fixes
- `audit-and-upgrade-deps` — vulnerability + outdated + unused dep audit
- `validate-and-fix` — full validation + fix issues one by one
- `onboard-to-project` — comprehensive project overview
- `add-test-for` — generate tests for a source file
- `explain-errors` — explain every diagnostic in plain English

## Part 4: Verify Your Installation

### Extension verification

1. Open a Node.js/TypeScript project in VS Code
2. Trust the workspace when prompted
3. The NodeForge sidebar should populate within a few seconds:
   - Workspace view shows `runtime=node`, `typescript=yes`, etc.
   - Diagnostics view shows findings (or "No diagnostics")
   - Git view shows your branch + dirty status

### MCP server verification

Test the MCP server manually:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | \
  NODEFORGE_WORKSPACE_ROOT=/home/nemesis/projects/developer-tools/nodeforge/packages/test-fixtures/node-ts-eslint \
  node /home/nemesis/projects/developer-tools/nodeforge/packages/agent/dist/cli.js
```

You should see a JSON response with `serverInfo.name = "nodeforge-mcp"`.

Test tools/list:

```bash
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | \
  NODEFORGE_WORKSPACE_ROOT=/home/nemesis/projects/developer-tools/nodeforge/packages/test-fixtures/node-ts-eslint \
  node /home/nemesis/projects/developer-tools/nodeforge/packages/agent/dist/cli.js
```

You should see 21 tools listed.

## Troubleshooting

### Extension doesn't appear in the sidebar

1. Check the extension is installed: `code --list-extensions | grep nodeforge`
2. Reload the window: `Ctrl+Shift+P` → "Developer: Reload Window"
3. Check the Output panel (`Ctrl+Shift+U`) for "NodeForge" channel messages

### Diagnostics are empty

1. Ensure Workspace Trust is granted (check the status bar)
2. Run `NodeForge: Analyze Workspace` manually
3. Run `NodeForge: Run Diagnostics` to force a refresh
4. Check that your project has `node_modules/` installed (`npm install`)

### MCP server won't connect in Cursor

1. Verify the path to `cli.js` is absolute and correct
2. Verify `NODEFORGE_WORKSPACE_ROOT` points to your project root
3. Check Cursor's MCP logs (Settings → MCP → logs icon)
4. Test the server manually (see Part 4 above)

### ESLint adapter fails

1. Ensure `eslint` is installed: `ls node_modules/.bin/eslint`
2. Ensure an ESLint config exists: `eslint.config.mjs` or `eslint.config.js`
3. Try running eslint manually: `npx eslint . --format json`

### TypeScript adapter fails

1. Ensure `typescript` is installed: `ls node_modules/.bin/tsc`
2. Ensure `tsconfig.json` exists
3. Try running tsc manually: `npx tsc --noEmit --pretty false`

## What's Next?

- **Performance profiling + bundle analysis** (planned)
- **More MCP prompts** for common workflows
- **Monorepo-aware diagnostics** (per-package adapter runs)
- **Custom adapter SDK** so you can add your own adapters


### MCP security configuration

The standalone MCP server does not inherit VS Code Workspace Trust. It starts fail-closed:

- reads are available by default;
- project code execution requires `NODEFORGE_ALLOW_EXECUTION=true` and `NODEFORGE_WORKSPACE_TRUSTED=true`;
- workspace mutations additionally require `NODEFORGE_ALLOW_WRITES=true`;
- network-dependent tools additionally require `NODEFORGE_ALLOW_NETWORK=true`;
- `runScript` is arbitrary project-controlled code execution and should be treated as high risk.

Enable these capabilities only for workspaces and package scripts you trust.
