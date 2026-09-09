# NodeForge Extension — Manual Test Guide

Use this document to smoke-test every NodeForge feature after installing the
extension or before a release. Check off each item as you go.

**Related docs:** [INSTALL.md](./INSTALL.md) (installation), [README.md](./README.md) (architecture)

---

## Prerequisites

| Requirement | Check |
|-------------|-------|
| Node.js 20+ (`node --version`) | ☐ |
| pnpm 9+ (`pnpm --version`) | ☐ |
| VS Code 1.85+ or Cursor | ☐ |
| git installed | ☐ |
| Extension built and installed (see below) | ☐ |

---

## 0. Build and install the extension

From the repo root:

```bash
pnpm install
pnpm build
cd packages/extension
npx @vscode/vsce package --no-dependencies --no-git-tag-version
cursor --install-extension ./nodeforge-0.0.1.vsix   # or: code --install-extension ...
```

Reload the editor: **Ctrl+Shift+P** → **Developer: Reload Window**.

| Step | Expected | Pass |
|------|----------|------|
| Extension appears in Extensions list (`nodeforge`) | Listed as installed | ☐ |
| NodeForge icon in activity bar | Sidebar opens with 8 views | ☐ |

---

## 1. Prepare test fixtures

Fixtures live in `packages/test-fixtures/`. They are miniature real projects.
**`node_modules` is not committed** — install deps before opening a fixture.

### Quick bootstrap (run once per fixture you plan to test)

```bash
REPO=/home/nemesis/projects/developer-tools/nodeforge
for dir in node-ts-eslint node-ts-with-errors node-ts-biome node-ts-biome-lint \
           node-ts-vitest node-ts-jest node-ts-prisma node-ts-drizzle \
           node-ts-docker node-ts-deps node-ts-depgraph; do
  echo "=== $dir ==="
  (cd "$REPO/packages/test-fixtures/$dir" && npm install)
done
```

For the pnpm monorepo fixture:

```bash
cd packages/test-fixtures/pnpm-monorepo && pnpm install
```

### Fixture reference

| Fixture | What it exercises |
|---------|-------------------|
| `node-ts-eslint` | **Primary all-in-one** — ESLint, Prettier, Jest, Prisma, Docker, GitHub Actions |
| `node-ts-with-errors` | TypeScript + ESLint diagnostics (deliberate errors in `src/broken.ts`) |
| `node-ts-biome` | Biome linter + formatter, Vitest, Drizzle ORM |
| `node-ts-biome-lint` | Biome-only lint findings |
| `node-ts-vitest` | Vitest test runner (includes one failing test) |
| `node-ts-jest` | Jest test runner (includes one failing test) |
| `node-ts-prisma` | Prisma schema detection |
| `node-ts-drizzle` | Drizzle schema detection |
| `node-ts-docker` | Dockerfile, docker-compose, k8s manifests, GitHub Actions |
| `node-ts-deps` | Dependency audit (old `lodash` version) |
| `node-ts-depgraph` | Unused dep (`lodash`), circular imports (`a→b→c→a`) |
| `pnpm-monorepo` | pnpm workspaces, Turborepo, multi-package detection |

---

## 2. Automated backend tests (no editor)

Run before manual UI testing to catch adapter/detector regressions.

```bash
pnpm install
pnpm build
pnpm test
```

| Step | Expected | Pass |
|------|----------|------|
| All packages build without error | `pnpm build` exits 0 | ☐ |
| Unit + integration tests pass | `pnpm test` exits 0 | ☐ |

> **Known issue:** `packages/core` may fail `packageManager` detection for
> `node-ts-eslint` (`expected 'npm', received 'unknown'`). This does not block
> extension UI testing but should be tracked.

---

## 3. Extension activation and sidebar

Open the primary fixture:

```bash
cursor /home/nemesis/projects/developer-tools/nodeforge/packages/test-fixtures/node-ts-eslint
```

**Trust the workspace** when prompted.

| View | Expected on load | Pass |
|------|------------------|------|
| **Workspace** | Profile fields populated within a few seconds | ☐ |
| **Diagnostics** | Auto-runs; shows findings or "No diagnostics" | ☐ |
| **Tests** | Empty or placeholder until tests are run | ☐ |
| **Runtime** | Empty (no processes yet) | ☐ |
| **Git** | Branch name + dirty/clean status | ☐ |
| **Database** | Prisma tables after auto-detect | ☐ |
| **Dependencies** | Empty until audit is run | ☐ |
| **Agent** | MCP Server status "ready", tool list visible | ☐ |

---

## 4. Workspace detection

**Fixture:** `node-ts-eslint` (trusted)

### 4.1 Auto-detection on activation

| Field | Expected value | Pass |
|-------|----------------|------|
| runtime | `node` | ☐ |
| typescript | `yes` | ☐ |
| linter | `eslint` | ☐ |
| formatter | `prettier` | ☐ |
| test runner | `jest` | ☐ |
| orm | `prisma` | ☐ |
| docker | `yes` | ☐ |
| github actions | `yes` | ☐ |
| monorepo | `none` | ☐ |

### 4.2 Analyze Workspace command

**Ctrl+Shift+P** → **NodeForge: Analyze Workspace**

| Step | Expected | Pass |
|------|----------|------|
| Toast notification | Summary like `runtime=node, pm=..., ts=yes, linter=eslint, ...` | ☐ |
| Workspace view refreshes | All fields match table above | ☐ |

### 4.3 Toolbar button

Click the refresh/analyze icon in the **Workspace** view title bar.

| Step | Expected | Pass |
|------|----------|------|
| Same as command | Profile re-detected | ☐ |

### 4.4 Biome fixture

Open `node-ts-biome` (trusted, deps installed).

| Field | Expected | Pass |
|-------|----------------|------|
| linter | `biome` | ☐ |
| formatter | `biome` | ☐ |
| test runner | `vitest` | ☐ |
| orm | `drizzle` | ☐ |
| docker | `no` | ☐ |

### 4.5 pnpm monorepo fixture

Open `pnpm-monorepo` (trusted).

| Field | Expected | Pass |
|-------|----------------|------|
| package manager | `pnpm` | ☐ |
| monorepo | `pnpm` | ☐ |
| workspace packages | Includes `api`, `web`, `shared` | ☐ |

### 4.6 Config file watcher

With `node-ts-eslint` open, edit `package.json` (add a harmless field) and save.

| Step | Expected | Pass |
|------|----------|------|
| Workspace view | Re-analyzes automatically | ☐ |

---

## 5. Diagnostics

### 5.1 ESLint + TypeScript (primary)

**Fixture:** `node-ts-with-errors` (trusted, deps installed)

**NodeForge: Run Diagnostics** (or click ▶ in Diagnostics view title bar)

| Step | Expected | Pass |
|------|----------|------|
| Progress notification | "NodeForge: running diagnostics" | ☐ |
| Completion toast | Reports finding count (errors + warnings > 0) | ☐ |
| Diagnostics tree | Groups by source: **TypeScript**, **ESLint** | ☐ |
| TypeScript findings | Errors in `src/broken.ts` (e.g. `undefinedVariable`, type mismatch) | ☐ |
| ESLint findings | `no-undef`, `no-unused-vars`, `no-empty` in `src/broken.ts` | ☐ |

### 5.2 Click-to-navigate

Click any diagnostic row in the tree.

| Step | Expected | Pass |
|------|----------|------|
| Editor opens file | Correct file at correct line/column | ☐ |

### 5.3 Biome linter

**Fixture:** `node-ts-biome-lint` (trusted, deps installed)

| Step | Expected | Pass |
|------|----------|------|
| Run Diagnostics | Findings grouped under **Biome** | ☐ |
| Findings | Errors in `src/broken.ts` | ☐ |

### 5.4 Save-triggered refresh

**Fixture:** `node-ts-with-errors`

| Step | Expected | Pass |
|------|----------|------|
| Edit and save a `.ts` file | Diagnostics refresh after debounce (~1–2 s) | ☐ |

### 5.5 Aggressive refresh setting

**Settings** → search `nodeforge.diagnostics.aggressiveRefresh` → enable

| Step | Expected | Pass |
|------|----------|------|
| Save a file | Diagnostics refresh immediately (no debounce) | ☐ |

Reset setting to `false` after testing.

---

## 6. Tests

### 6.1 Vitest

**Fixture:** `node-ts-vitest` (trusted, deps installed)

**NodeForge: Run Tests**

| Step | Expected | Pass |
|------|----------|------|
| Progress notification | "NodeForge: running tests" | ☐ |
| Completion toast | e.g. `6 passed, 1 failed, 0 skipped` | ☐ |
| Tests tree | Suite `math` with pass ✓ and fail ✗ icons | ☐ |
| Failing test | `intentionally failing assertion` shown as failed | ☐ |

### 6.2 Jest

**Fixture:** `node-ts-jest` (trusted, deps installed)

| Step | Expected | Pass |
|------|----------|------|
| Run Tests | Same structure as Vitest above | ☐ |
| test runner in Workspace view | `jest` | ☐ |

### 6.3 No test runner

**Fixture:** `node-ts-deps` (no test script)

| Step | Expected | Pass |
|------|----------|------|
| Run Tests | Warning: "no test runner detected" | ☐ |

---

## 7. Git

**Fixture:** any fixture inside the git repo (e.g. `node-ts-eslint`)

**NodeForge: Refresh Git State**

| Step | Expected | Pass |
|------|----------|------|
| Toast | `branch=<name>, dirty|clean` | ☐ |
| Git view | Branch, HEAD, dirty status | ☐ |
| Changed files | Listed if you have uncommitted edits | ☐ |
| Staged files | Listed if you have staged changes | ☐ |

### Staging test (optional)

```bash
cd packages/test-fixtures/node-ts-eslint
echo "# test" >> README.md
git add README.md
```

| Step | Expected | Pass |
|------|----------|------|
| Refresh Git | Shows file under staged | ☐ |

```bash
git reset HEAD README.md && rm -f README.md   # cleanup
```

---

## 8. Database schema

### 8.1 Prisma

**Fixture:** `node-ts-eslint` or `node-ts-prisma`

**NodeForge: Detect Database Schema**

| Step | Expected | Pass |
|------|----------|------|
| Progress notification | "NodeForge: detecting database schema" | ☐ |
| Toast | Reports table count + product `prisma` | ☐ |
| Database view | Tables → columns, indexes, relations | ☐ |

### 8.2 Drizzle

**Fixture:** `node-ts-biome` or `node-ts-drizzle`

| Step | Expected | Pass |
|------|----------|------|
| Detect Database Schema | Tables from Drizzle schema files | ☐ |
| product | `drizzle` | ☐ |

### 8.3 No ORM

**Fixture:** `node-ts-deps`

| Step | Expected | Pass |
|------|----------|------|
| Detect Database Schema | Info: "no ORM detected" | ☐ |

---

## 9. Dependencies

**Fixture:** `node-ts-eslint` or `node-ts-deps` (trusted, deps + lockfile installed)

**NodeForge: Audit Dependencies**

| Step | Expected | Pass |
|------|----------|------|
| Progress notification | "NodeForge: running dependency audit" | ☐ |
| Toast | Vulnerability/outdated counts or "up to date" | ☐ |
| Dependencies view | Vulnerabilities grouped by severity | ☐ |
| Dependencies view | Outdated packages listed | ☐ |

For `node-ts-deps` specifically: expect findings related to old `lodash@4.17.20`.

---

## 10. Runtime

The Runtime view shows processes managed by NodeForge's `ProcessManager`. The
extension does not currently expose a "start process" command in the palette;
runtime entries appear when long-lived processes are started through NodeForge
internals or future commands.

| Step | Expected | Pass |
|------|----------|------|
| Runtime view loads | Shows "No running processes" or empty state | ☐ |
| No errors in Developer Tools console | Open **Help → Toggle Developer Tools** | ☐ |

> **Note:** Full runtime smoke testing requires a future command or API to start
> a watched process. For now, verify the view renders without errors.

---

## 11. Agent view

**Fixture:** any open workspace

| Step | Expected | Pass |
|------|----------|------|
| MCP Server → Status | `ready` | ☐ |
| MCP Server → Workspace | Current folder path | ☐ |
| Available Tools | Lists all MCP tools (17) | ☐ |
| Setup section | Cursor + Claude Code config hints | ☐ |

---

## 12. Refresh command

**Ctrl+Shift+P** → **NodeForge: Refresh**

| Step | Expected | Pass |
|------|----------|------|
| All sidebar views | Re-render without error | ☐ |

---

## 13. Workspace Trust (Restricted Mode)

Open `node-ts-with-errors` in a **new window** and choose **Don't Trust** (or
open in Restricted Mode).

| Step | Expected | Pass |
|------|----------|------|
| Workspace view | Profile still detected (read-only) | ☐ |
| Run Diagnostics | Warning: "requires Workspace Trust" | ☐ |
| Run Tests | Warning: "requires Workspace Trust" | ☐ |
| Audit Dependencies | Warning: "requires Workspace Trust" | ☐ |

Then trust the workspace and re-run the blocked commands — they should succeed.

| Step | Expected | Pass |
|------|----------|------|
| Trust workspace | Diagnostics and tests now run | ☐ |

---

## 14. Settings

Open **Settings** → search `nodeforge`.

| Setting | Test | Expected | Pass |
|---------|------|----------|------|
| `nodeforge.runtime.preferredNodeBinary` | Set to a valid Node path | Adapters still run | ☐ |
| `nodeforge.diagnostics.aggressiveRefresh` | Toggle on/off | Save refresh behavior changes (see §5.5) | ☐ |

---

## 15. MCP server (agent integration)

Build the agent:

```bash
pnpm build   # from repo root
```

### 15.1 Manual CLI smoke test

```bash
FIXTURE=/home/nemesis/projects/developer-tools/nodeforge/packages/test-fixtures/node-ts-docker
CLI=/home/nemesis/projects/developer-tools/nodeforge/packages/agent/dist/cli.js

# Initialize
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | \
  NODEFORGE_WORKSPACE_ROOT="$FIXTURE" node "$CLI"

# List tools
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | \
  NODEFORGE_WORKSPACE_ROOT="$FIXTURE" node "$CLI"
```

| Step | Expected | Pass |
|------|----------|------|
| initialize response | `serverInfo.name` = `nodeforge-mcp` | ☐ |
| tools/list | 17 tools returned | ☐ |

### 15.2 Tool smoke tests (read-only)

Use `node-ts-docker` as workspace root. Call each tool via `tools/call`:

```bash
call_tool() {
  local name="$1"
  local args="${2:-{}}"
  echo "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$name\",\"arguments\":$args}}" | \
    NODEFORGE_WORKSPACE_ROOT="$FIXTURE" node "$CLI"
}
```

| Tool | Fixture | Expected (non-empty JSON) | Pass |
|------|---------|---------------------------|------|
| `getProjectContext` | `node-ts-docker` | `runtime`, `linter`, etc. | ☐ |
| `getDiagnostics` | `node-ts-with-errors` | Array of findings | ☐ |
| `runTypeCheck` | `node-ts-with-errors` | TypeScript errors only | ☐ |
| `runLinter` | `node-ts-with-errors` | ESLint findings only | ☐ |
| `getTestResults` | `node-ts-vitest` | Suites + pass/fail counts | ☐ |
| `getGitState` | any in git repo | `branch`, `dirty` | ☐ |
| `getDependencyReport` | `node-ts-eslint` | vulnerabilities or outdated | ☐ |
| `getDatabaseSchema` | `node-ts-eslint` | Prisma tables | ☐ |
| `getDockerConfig` | `node-ts-docker` | Dockerfile + compose | ☐ |
| `getKubernetesManifests` | `node-ts-docker` | k8s resources | ☐ |
| `getGitHubWorkflows` | `node-ts-docker` | CI workflows | ☐ |
| `getDependencyGraph` | `node-ts-depgraph` | unused + circular deps | ☐ |

### 15.3 Action tools (modify workspace — use a copy or expect changes)

| Tool | Fixture | Expected | Pass |
|------|---------|----------|------|
| `runScript` | `node-ts-vitest`, script=`test` | exit code + output | ☐ |
| `formatFiles` | `node-ts-eslint` | files formatted count | ☐ |
| `applyEslintFix` | `node-ts-with-errors` | auto-fixable issues resolved | ☐ |
| `validateWorkspace` | `node-ts-eslint` | per-stage pass/fail report | ☐ |

### 15.4 MCP prompts

```bash
echo '{"jsonrpc":"2.0","id":3,"method":"prompts/list","params":{}}' | \
  NODEFORGE_WORKSPACE_ROOT="$FIXTURE" node "$CLI"
```

| Prompt | Pass |
|--------|------|
| `fix-lint-errors` | ☐ |
| `audit-and-upgrade-deps` | ☐ |
| `validate-and-fix` | ☐ |
| `onboard-to-project` | ☐ |
| `add-test-for` | ☐ |
| `explain-errors` | ☐ |

### 15.5 Cursor MCP integration

Add to `.cursor/mcp.json` in a test project:

```json
{
  "mcpServers": {
    "nodeforge": {
      "command": "node",
      "args": ["/home/nemesis/projects/developer-tools/nodeforge/packages/agent/dist/cli.js"],
      "env": {
        "NODEFORGE_WORKSPACE_ROOT": "/home/nemesis/projects/developer-tools/nodeforge/packages/test-fixtures/node-ts-eslint"
      }
    }
  }
}
```

Restart Cursor.

| Step | Expected | Pass |
|------|----------|------|
| MCP settings | `nodeforge` server connected (green) | ☐ |
| Agent chat | "What does this project use?" returns structured profile | ☐ |
| Agent chat | "Run diagnostics" returns findings | ☐ |

---

## 16. Error handling

| Scenario | How to trigger | Expected | Pass |
|----------|----------------|----------|------|
| No workspace folder | Close all folders, run Analyze Workspace | Warning: "open a workspace folder" | ☐ |
| Missing node_modules | Open fixture without `npm install`, run Diagnostics | Graceful failure or empty findings (no crash) | ☐ |
| Non-git directory | Open `/tmp` as workspace, Refresh Git | "not a git repository" | ☐ |

---

## 17. Sign-off checklist

Use this for release or PR verification.

| Area | Pass |
|------|------|
| Extension installs from `.vsix` | ☐ |
| All 8 sidebar views render | ☐ |
| Workspace detection (ESLint + Biome + monorepo fixtures) | ☐ |
| Diagnostics (TS + ESLint + Biome) | ☐ |
| Click-to-navigate diagnostics | ☐ |
| Tests (Vitest + Jest) | ☐ |
| Git state | ☐ |
| Database (Prisma + Drizzle) | ☐ |
| Dependency audit | ☐ |
| Agent view | ☐ |
| Workspace Trust gating | ☐ |
| MCP server (17 tools, 6 prompts) | ☐ |
| `pnpm test` green | ☐ |

**Tester:** _______________  
**Date:** _______________  
**Extension version:** 0.0.1  
**Editor:** VS Code / Cursor _______________  

---

## Quick test path (~15 minutes)

If you only have time for a minimal smoke test:

1. `pnpm install && pnpm build && pnpm test`
2. Package and install the `.vsix` (see §0)
3. `npm install` in `packages/test-fixtures/node-ts-eslint`
4. Open that fixture in Cursor, trust workspace
5. Verify all 8 sidebar views populate
6. Run **Analyze Workspace**, **Run Diagnostics**, **Run Tests**, **Refresh Git**,
   **Detect Database Schema**, **Audit Dependencies**
7. Open `node-ts-with-errors`, run diagnostics, click a finding
8. MCP: `initialize` + `tools/list` via CLI (§15.1)
