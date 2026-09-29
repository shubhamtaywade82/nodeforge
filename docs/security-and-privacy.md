# Security, Privacy, and Model Data Flow

NodeForge has two model-driven paths: built-in chat and the native Ollama provider. Neither should be treated as an implicit local-only boundary unless the configured model endpoint is local.

## Built-in chat

The built-in chat path constructs an LLM request from:

1. the user's conversation text and selected chat history;
2. the NodeForge system prompt;
3. optionally, a workspace snapshot containing detected stack/profile data and cached dependency/dependency-graph summaries;
4. tool definitions exposed to the model;
5. tool results returned during the agent loop.

The configured OpenAI-compatible endpoint receives the resulting request. The API key is stored in VS Code Secret Storage.

NodeForge does not intentionally include arbitrary workspace files in the snapshot. MCP configuration resources are separately allowlisted and do not include `.env` or arbitrary source files.

## Native Ollama provider

The native provider discovers models from the configured Ollama server and forwards VS Code language-model messages through Ollama's OpenAI-compatible API.

The default endpoint is `http://localhost:11434`.

A remote endpoint can be configured with `nodeforge.ollama.baseUrl`. Operators should treat remote endpoints according to their provider's logging, retention, training, and access-control policies.

## Repository content is untrusted

A repository can contain instructions designed to manipulate an AI system. NodeForge therefore treats workspace files, package metadata, diagnostics, Git output, and tool results as untrusted data. These sources cannot grant permissions or override system policy.

## Tool execution

The central policy layer separates:

- read-only inspection;
- project-code execution;
- workspace mutation;
- network-dependent execution.

Standalone MCP defaults to the least-privileged state. Built-in chat additionally requests explicit approval for write operations and package scripts.

## Recommended operating model

For sensitive repositories, use a local model endpoint, keep workspace trust decisions explicit, do not enable standalone MCP capabilities that are not required for the task, and review the resulting diff after mutation.

This document describes NodeForge's intended data flow; individual model providers may add their own telemetry or retention outside NodeForge's control.