# Extension-host tests

Runs NodeForge inside a real VS Code ([Testing extensions](https://code.visualstudio.com/api/working-with-extensions/testing-extension)).

```bash
pnpm -C packages/extension-vscode-tests test          # all configurations (needs a display; use xvfb-run on Linux)
npx --no-install vscode-test --label untrusted         # one configuration (after the first run installed the tooling)
```

| Label | Workspace | Covers |
|---|---|---|
| `host` | `packages/test-fixtures/node-ts-eslint` | Smoke tests: activation, commands, analyze, run tests |
| `trusted` | `test/fixtures/workspace` | Language-model tools, reports, task matchers/groups, terminal profile, debug `.env` injection, Ollama provider (stub server) |
| `untrusted` | `test/fixtures/workspace` | Restricted Mode: execution tools and diagnostics refused, read-only inspection still works |

`@vscode/test-electron` always passes `--disable-workspace-trust`, so `untrusted` launches VS Code through a generated wrapper (`.vscode-test/code-restricted.sh`) that drops it (macOS/Linux only). Set `VSCODE_TEST_VERSION` to test another VS Code build.

Not covered because VS Code exposes no API to list or drive them: the `@nodeforge` participant's responses, the MCP provider starting, and the Test Explorer Debug profile.
