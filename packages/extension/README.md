# NodeForge VS Code extension

Autonomous Node.js / TypeScript engineering sidebar for VS Code and Cursor.

## Documentation

- **[Extension user guide](../../docs/extension-user-guide.md)** — install, views, commands, chat, settings
- **[DevDocs integration](../../docs/devdocs.md)** — embedded documentation
- **[INSTALL.md](../../INSTALL.md)** — quick install and optional MCP
- **[TESTING.md](../../TESTING.md)** — manual test checklist

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

Produces `nodeforge-0.0.1.vsix` in this directory.
