# NodeForge VS Code extension

Autonomous Node.js / TypeScript engineering sidebar for VS Code and Cursor.

## Documentation

- **[Extension user guide](../../docs/extension-user-guide.md)** — install, views, commands, chat, settings
- **[DevDocs integration](../../docs/devdocs.md)** — embedded documentation
- **[INSTALL.md](../../docs/INSTALL.md)** — quick install and optional MCP
- **[TESTING.md](../../docs/TESTING.md)** — manual test checklist

## Native VS Code integrations

| Feature | How to use it |
|---|---|
| `@nodeforge` chat participant | In VS Code Chat type `@nodeforge`, or use `/context`, `/diagnostics`, `/tests`, `/deps`, `/db`, `/git`, `/validate`. Uses the model selected in the Chat picker and the `nodeforge_*` language-model tools. |
| Native MCP server | Registered automatically in trusted workspaces (bundled as `dist/mcp.cjs`); no `mcp.json` needed in VS Code. Execution is on by default; `nodeforge.mcp.allowWrites` and `nodeforge.mcp.allowNetwork` are opt-in. |
| Reports | `NodeForge: Open Report` opens read-only `nodeforge:` documents (profile, diagnostics, graph, audit, schema, tests, git diff), produced through the same policy layer as the tools. |
| Tasks | `package.json` scripts appear as tasks with `$tsc` / `$tsc-watch` / `$eslint-stylish` problem matchers and build/test/clean groups. |
| Terminal | *NodeForge* profile in the new-terminal dropdown (trusted workspaces only). |
| Keybindings | `Ctrl+Alt+N` then `D` diagnostics, `T` tests, `R` reports, `C` chat (`Cmd+Alt+N` on macOS). |
| State | The last workspace profile is cached in `workspaceState` so views populate instantly and in Restricted Mode. |

In Restricted Mode only read-only project inspection is offered; everything that executes project code is refused by the central tool policy.

## Develop

```bash
pnpm install
pnpm --filter @nodeforge/contracts build
pnpm --filter @nodeforge/agent build
pnpm --filter nodeforge build
```

Press **F5** in `packages/extension` to launch the Extension Development Host.

## Package

```bash
pnpm --filter nodeforge package
```

Produces `nodeforge-0.1.0.vsix` in this directory.

## AI Providers & Chat Configuration

NodeForge Chat supports multiple backend AI providers with scoped endpoints and secure credential resolution:

- **Anthropic**: Set `nodeforge.ai.provider` to `"anthropic"`. Configurable via `nodeforge.ai.anthropic.baseUrl` (default `https://api.anthropic.com`) and `nodeforge.ai.anthropic.model` (default `claude-sonnet-4-5`).
- **OpenAI / Compatible**: Set `nodeforge.ai.provider` to `"openai"`. Configurable via `nodeforge.ai.openai.baseUrl` (supports OpenAI, OpenRouter, LiteLLM, vLLM) and `nodeforge.ai.openai.model` (default `gpt-4o-mini`).
- **Ollama**: Set `nodeforge.ai.provider` to `"ollama"`. Configurable via `nodeforge.ai.ollama.baseUrl` (default `http://localhost:11434`) and `nodeforge.ai.ollama.model` (default `qwen2.5-coder:14b`).

To configure API keys securely, run command:
`NodeForge: Set AI Provider API Key` (`nodeforge.setAiApiKey`)

Key resolution follows multi-tier fallback: VS Code SecretStorage → Workspace/User settings → Environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OLLAMA_API_KEY`).

## Native Ollama provider

NodeForge registers **NodeForge Ollama** as a native VS Code language-model provider. With Ollama running locally (default `http://localhost:11434`), available models are discovered from the Ollama API and advertised to VS Code with tool-calling/vision capability metadata. Configure `nodeforge.ollama.baseUrl` for a different server.
