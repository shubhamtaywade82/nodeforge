# Changelog

All notable changes to NodeForge. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- **Explain with NodeForge:** Quick Fix on every NodeForge diagnostic, a link in diagnostic hovers, and an editor context-menu command. Each opens chat with `@nodeforge /explain`, which reads the real file through the source tools and explains the finding and the smallest fix. `/explain` and `/context` now work in Restricted Mode (read-only tools only).
- DevDocs hovers open the offline page beside the editor (`nodeforge.openOfflineDoc`; arguments are validated and confined to the offline cache).
- Agent source tools: `readFile`, `searchCode`, `applyPatch` (VS Code LM tools, MCP, `@nodeforge /fix`, `/addtests`). Reads/searches work in Restricted Mode; patching requires Workspace Trust and an explicit confirmation. Secrets (`.env*`, keys, `.npmrc`), `.git`, `node_modules` and symlinks are never read or written.
- Granular `runScript` risk classification (`low`/`medium`/`high`) with the resolved commands shown in the confirmation, following scripts that call other scripts and `pre`/`post` hooks.
- Multi-root workspaces: one active folder at a time, `NodeForge: Select Workspace Folder`, a status bar item, optional `nodeforge.workspace.followActiveEditor`, automatic fallback when the active folder is removed. Tasks, debug configurations, the MCP server and the agent session follow the active folder.
- Ollama: image input for vision models (png/jpeg/gif/webp, ≤10 MB), cached `/api/tags` and `/api/show` metadata, `NodeForge: Configure Ollama` (test connection, set URL).
- The `@nodeforge` participant keeps structured tool calls/results across turns instead of flattening them to text.
- `nodeforge.debug.loadDotEnv` (default off): opt-in `.env` injection into debug sessions; only variable names are logged.
- Tool and activation timing in the NodeForge output channel.

### Changed
- Prompts and agent definitions now only name tools that exist (enforced by a contract test).
- Debug configurations and the “Debug test from file” command never invoke `npx`; they use the project-local runner or `node --import tsx` / `--experimental-strip-types`.
- Background dependency audit and graph analysis are cancellable and latest-wins.

### Security
- DevDocs panels: full HTML escaping, iframe `sandbox`, `referrerpolicy=no-referrer`, host-side and webview-side URL allowlist (`https://devdocs.io` only).
- Chat markdown renderer extracted to a tested module (escape-first, fixed tag set, no links or images).

### Tests
- Extension-host suites: `host`, `trusted`, `multiroot`, `untrusted` (Restricted Mode refusal of every execution/write tool).
