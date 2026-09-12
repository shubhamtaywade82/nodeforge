# NodeForge extension — user guide

NodeForge is a **control plane** for Node.js, JavaScript, and TypeScript projects in VS Code and Cursor. It detects your stack, runs your existing tools (`tsc`, ESLint, Biome, Vitest, Jest, …), surfaces results in the sidebar, and provides built-in **Chat** (OpenAI-compatible) plus optional **MCP** for external agents.

**Version:** 0.0.1 (alpha). See [readiness notes](#limitations) before adopting team-wide.

---

## Prerequisites

- VS Code **1.85+** or **Cursor**
- **Node.js 20+** on your PATH (or set `nodeforge.runtime.preferredNodeBinary`)
- Project dependencies installed (`npm install` / `pnpm install`) so local `tsc`, `eslint`, etc. resolve
- **Git** (optional, for Git view)

---

## Installation

1. Build or obtain `nodeforge-0.0.1.vsix` (see [INSTALL.md](../INSTALL.md)).
2. Install: **Extensions → … → Install from VSIX**, or  
   `cursor --install-extension nodeforge-0.0.1.vsix`
3. Reload the window.
4. Open a Node/TS project folder and **Trust** the workspace when prompted.

---

## Sidebar views

| View | Purpose |
|------|---------|
| **Workspace** | Detected runtime, package manager, TypeScript, linter, formatter, tests, ORM, Docker, CI, monorepo |
| **Diagnostics** | TypeScript + ESLint/Biome findings (refreshes on save when trusted) |
| **Tests** | Vitest/Jest tree after **Run Tests** |
| **Runtime** | Long-lived processes managed by NodeForge |
| **Git** | Branch, dirty state, changed/staged files |
| **Database** | Prisma/Drizzle schema tree |
| **Dependencies** | Vulnerabilities, outdated packages, unused/circular/missing deps |
| **Chat** | Built-in AI assistant (API key required) |
| **Docs** | [DevDocs.io](https://devdocs.io) embedded documentation |
| **Agent** | MCP server reference (optional external agents) |

---

## Essential commands

| Command | Action |
|---------|--------|
| `NodeForge: Analyze Workspace` | Re-run stack detection |
| `NodeForge: Run Diagnostics` | Typecheck + lint |
| `NodeForge: Run Tests` | Vitest or Jest |
| `NodeForge: Audit Dependencies` | `audit` + outdated |
| `NodeForge: Analyze Dependency Graph` | Unused / circular / missing imports |
| `NodeForge: Set Chat API Key` | Store OpenAI-compatible key |
| `NodeForge: Open Chat` | Focus Chat view |
| `NodeForge: Search DevDocs` | Search selection on DevDocs |
| `NodeForge: Open DevDocs for Workspace` | Docset from detected stack |

Full list: Command Palette → filter `NodeForge`.

---

## Built-in Chat

1. **NodeForge: Set Chat API Key** (Secret Storage).
2. Open **Chat** in the sidebar.
3. Ask in plain language or use chips / slash workflows:  
   `/audit-and-upgrade-deps`, `/validate-and-fix`, `/onboard-to-project`, `/explain-errors`

The assistant calls the same engineering tools as the MCP server (diagnostics, tests, git, deps, format/fix when trusted).

### Chat settings

| Setting | Default | Description |
|---------|---------|-------------|
| `nodeforge.chat.baseUrl` | `https://api.openai.com/v1` | OpenAI-compatible API |
| `nodeforge.chat.model` | `gpt-4o-mini` | Model id |
| `nodeforge.chat.maxToolRounds` | `8` | Tool loop limit per message |
| `nodeforge.chat.injectWorkspaceSnapshot` | `true` | Profile + dep summary each turn |

**Trust:** Write tools (`formatFiles`, `applyEslintFix`, `runScript`, `validateWorkspace`) run only in **Trusted** workspaces.

---

## Documentation (DevDocs)

See [devdocs.md](./devdocs.md). Summary:

- **Docs** view embeds DevDocs.io (network required).
- **NodeForge: Sync DevDocs Offline** downloads docsets for your stack (+ `extraSlugs`) into extension storage.
- **Search DevDocs** prefers offline results when synced; opens local HTML or falls back to online search.
- `nodeforge.docs.offline.autoSync` optionally syncs after workspace analyze (off by default).
- `nodeforge.docs.preferExternal` opens online docs in the browser instead of the sidebar.

---

## Workspace Trust

| Mode | Inspection | Run tools / tests / audits | Chat write tools |
|------|------------|----------------------------|------------------|
| **Restricted** | Profile visible | Blocked | Blocked |
| **Trusted** | Full | Allowed | Allowed |

---

## Settings reference

| Setting | Default | Description |
|---------|---------|-------------|
| `nodeforge.diagnostics.aggressiveRefresh` | `false` | Diagnostics on every save (no debounce) |
| `nodeforge.dependencies.backgroundAudit` | `true` | Auto audit when root `package.json` changes |
| `nodeforge.dependencies.backgroundGraphAnalysis` | `true` | Auto graph analysis on activation / `package.json` change |
| `nodeforge.docs.preferExternal` | `false` | DevDocs in browser vs sidebar |
| `nodeforge.runtime.preferredNodeBinary` | `""` | Fixed Node binary path |

---

## Optional: MCP agent server

Built-in Chat does **not** require MCP. To connect Claude Code or another MCP client, build `packages/agent` and add `.cursor/mcp.json` — see [INSTALL.md](../INSTALL.md) and [packages/agent/README.md](../packages/agent/README.md).

---

## Limitations (0.0.1)

- **Companion, not replacement** for the TypeScript language service, ESLint extension, or Test Explorer.
- TypeScript/ESLint/Biome results appear primarily in the **NodeForge Diagnostics** tree; dependency issues also appear in **Problems**.
- **First workspace folder** only in multi-root setups.
- Distributed via **VSIX / source**, not the public Marketplace yet.
- Extension automated integration tests are still planned (`TESTING.md` for manual QA).

---

## Getting help

- Manual QA checklist: [TESTING.md](../TESTING.md)
- Architecture / contributing: [CLAUDE.md](../CLAUDE.md)
- Report issues in your project’s issue tracker (if published)
