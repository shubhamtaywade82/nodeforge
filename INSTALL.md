# NodeForge — Local Installation Guide

This guide walks you through installing the NodeForge VS Code extension and
configuring the MCP agent server for Cursor.

## Prerequisites

- **Node.js** 20+ (check with `node --version`)
- **pnpm** 9+ (install with `npm install -g pnpm` or `corepack enable`)
- **VS Code** 1.85+ or **Cursor** (any recent version)
- **git** (for the Git adapter)
- **Your project's dev dependencies installed** (`npm install` or `pnpm install`
  in your project root — NodeForge runs your project's own `tsc`, `eslint`,
  `vitest`, etc.)

## Part 1: Install the VS Code Extension

### Option A: Install from the .vsix file

1. Get the `nodeforge-0.0.1.vsix` file from `packages/extension/` or the
   `download/` directory.

2. Install via command line:

   ```bash
   code --install-extension nodeforge-0.0.1.vsix
   ```

   Or in Cursor:

   ```bash
   cursor --install-extension nodeforge-0.0.1.vsix
   ```

3. Or install via the UI:
   - Open VS Code / Cursor
   - Go to Extensions (`Ctrl+Shift+X` / `Cmd+Shift+X`)
   - Click the "..." menu → "Install from VSIX..."
   - Select the `nodeforge-0.0.1.vsix` file

4. Reload the window (`Ctrl+Shift+P` → "Developer: Reload Window")

### Option B: Run from source (development mode)

If you want to modify NodeForge itself:

```bash
cd /path/to/nodeforge
pnpm install
pnpm build
```

Then in VS Code / Cursor:

1. Open the `packages/extension/` folder
2. Press `F5` to launch an Extension Development Host
3. The NodeForge sidebar will appear in the new window

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

The chat uses the same 17 engineering tools as the MCP server. Write tools
(`formatFiles`, `applyEslintFix`, `runScript`, `validateWorkspace`) run automatically
when the workspace is **Trusted**; they are blocked in Restricted Mode.

Configure the model and API base URL under **Settings → NodeForge → Chat**.

On activation (trusted workspaces), NodeForge can automatically run a dependency
**audit** and **graph analysis** — toggle under **Settings → NodeForge → Dependencies**
(`backgroundAudit`, `backgroundGraphAnalysis`).

### Commands (`Ctrl+Shift+P` / `Cmd+Shift+P`)

- `NodeForge: Analyze Workspace` — re-detect the workspace profile
- `NodeForge: Run Diagnostics` — run TypeScript + ESLint/Biome
- `NodeForge: Run Tests` — run Vitest or Jest
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
actions via 17 tools.

### Step 1: Build the MCP server

```bash
cd /path/to/nodeforge/packages/agent
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
      "args": ["/absolute/path/to/nodeforge/packages/agent/dist/cli.js"],
      "env": {
        "NODEFORGE_WORKSPACE_ROOT": "/absolute/path/to/your/project"
      }
    }
  }
}
```

Replace the paths with your actual locations.

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
JSON back.

### Available MCP Tools (17 total)

**Read-only tools (13):**

- `getProjectContext` — workspace profile
- `getDiagnostics` — TS + ESLint/Biome findings
- `runTypeCheck` — TypeScript compiler errors only
- `runLinter` — ESLint or Biome findings only
- `getTestResults` — test suite + run result
- `runTests` — alias for getTestResults
- `getGitState` — branch, dirty status, changed files
- `getDependencyReport` — vulnerabilities + outdated
- `getDatabaseSchema` — Prisma or Drizzle schema
- `getDockerConfig` — Dockerfile + docker-compose
- `getKubernetesManifests` — k8s resources
- `getGitHubWorkflows` — CI/CD workflows
- `getDependencyGraph` — unused + circular + missing deps

**Action tools (4):**

- `runScript` — run `npm run <script>` / `pnpm run <script>` / `yarn <script>`
- `formatFiles` — run Prettier or Biome with `--write`
- `applyEslintFix` — run ESLint with `--fix`
- `validateWorkspace` — combined typecheck + lint + tests + audit

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
  NODEFORGE_WORKSPACE_ROOT=/path/to/your/project \
  node /path/to/nodeforge/packages/agent/dist/cli.js
```

You should see a JSON response with `serverInfo.name = "nodeforge-mcp"`.

Test tools/list:

```bash
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | \
  NODEFORGE_WORKSPACE_ROOT=/path/to/your/project \
  node /path/to/nodeforge/packages/agent/dist/cli.js
```

You should see 17 tools listed.

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
