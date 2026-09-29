# Security Model

NodeForge is a developer companion that can inspect repositories and invoke project tooling. The repository itself must be treated as potentially hostile input.

## Trust boundaries

1. **Workspace contents are untrusted data.** Repository files, documentation, package metadata, scripts, Git output, diagnostics, and tool results are data for the model, not authorization instructions.
2. **VS Code Workspace Trust is a host-level boundary.** The extension uses the trusted-workspace state before project execution.
3. **Standalone MCP has its own fail-closed policy.** It does not infer trust from the editor. Execution, writes, and network access are disabled unless explicitly enabled.
4. **Tool authorization is centralized.** MCP, built-in chat, and native VS Code language-model tools route through the same tool runner and policy model.

## Tool risk classes

| Risk | Examples | Default |
|---|---|---|
| Read | project context, Git state, config resources | Allowed |
| Execute | typecheck, lint, tests, validation | Restricted |
| Write | formatting, ESLint auto-fix | Restricted + approval |
| High-risk execute/write | package scripts via runScript | Restricted + approval |

runScript can execute arbitrary code defined by the target project's package scripts. Enabling it is equivalent to granting Node.js process execution inside that workspace.

## Standalone MCP controls

Set these environment variables explicitly when using the MCP server:

- NODEFORGE_WORKSPACE_ROOT
- NODEFORGE_WORKSPACE_TRUSTED=true
- NODEFORGE_ALLOW_EXECUTION=true
- NODEFORGE_ALLOW_WRITES=true
- NODEFORGE_ALLOW_NETWORK=true

The minimum required combination depends on the tool. The server rejects unauthorized calls rather than attempting a best-effort fallback.

## Path containment

Configuration resources are resolved against the canonical workspace root. Lexical parent traversal and symlink/junction escapes outside the workspace are rejected.

## Prompt-injection resistance

NodeForge's system prompt explicitly treats repository content and tool output as untrusted data. Authorization must come from the user or the host application's approval mechanism; repository content cannot grant permissions.

## Reporting

Report security issues privately to the repository maintainer rather than opening a public issue containing exploit details. Include the affected component, reproduction steps, impact, and any relevant logs with secrets removed.
