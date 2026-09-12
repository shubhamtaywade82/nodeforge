# DevDocs.io integration

NodeForge embeds **[DevDocs.io](https://devdocs.io)** documentation in the sidebar **Docs** view and exposes commands to search docs from the editor.

DevDocs is a third-party documentation aggregator (MIT-licensed app by Thibaut Courouble). NodeForge does **not** host or mirror docsets; content is loaded from `https://devdocs.io` at runtime.

## What NodeForge provides

| Feature | Description |
|---------|-------------|
| **Docs sidebar** | Webview with an embedded DevDocs frame (default) |
| **Workspace-aware entry** | After workspace analyze, opens a sensible docset (e.g. TypeScript, Node, npm) |
| **Search selection** | Right-click → **NodeForge: Search DevDocs**, or command palette |
| **Open in browser** | Toolbar in the Docs view, or `nodeforge.docs.preferExternal` |

### Commands

- `NodeForge: Open DevDocs Home`
- `NodeForge: Open DevDocs for Workspace` — uses detected stack
- `NodeForge: Search DevDocs` — uses editor selection or word under cursor

### Settings

| Setting | Default | Meaning |
|---------|---------|---------|
| `nodeforge.docs.preferExternal` | `false` | If `true`, commands open the system browser instead of the sidebar |

## How docsets are chosen

`@nodeforge/core` maps the [workspace profile](../packages/contracts/src/workspace.ts) to DevDocs slugs (e.g. `javascript`, `typescript`, `node`, `npm`, `eslint`, `jest`, `vitest`, `docker`). See `suggestDevDocsSlugs()` in `packages/core/src/devdocs/suggestDevDocs.ts`.

Not every detected tool has a DevDocs docset. Missing slugs are skipped; the default landing docset is TypeScript when TS is enabled, otherwise Node or JavaScript.

## Can we “fully integrate” DevDocs?

| Approach | Feasible? | Notes |
|----------|-----------|-------|
| **Embedded webview (current)** | Yes | No public DevDocs API; iframe to `devdocs.io`. Requires network. Offline mode inside the iframe follows DevDocs’ own UI (user configures docsets on devdocs.io). |
| **Bundled offline docsets** | Possible, separate project | Extensions like [devdocs-adapter](https://github.com/mihnea-s/devdocs-adapter) download docsets locally and search via command palette. Heavy (storage, updates, maintenance). Not shipped inside NodeForge today. |
| **Scraping / republishing** | Not recommended | Violates DevDocs’ role as single host; licensing and ToS concerns. |
| **Companion extension** | Yes | Install **DevDocs Tab** or **devdocs-adapter** alongside NodeForge if you want offline search or palette-only UX. |

### Recommendation

- **Daily use:** NodeForge **Docs** view + **Search DevDocs** on selection.
- **Offline / airplane:** Use DevDocs’ built-in offline install inside the embedded view, or install a dedicated DevDocs VS Code extension.
- **Future NodeForge work:** Optional docset sync (devdocs-adapter style) behind a setting, or deep-link chat answers to DevDocs URLs.

## Security and privacy

- Embedded view only loads `https://devdocs.io` (CSP `frame-src`).
- Queries are sent to DevDocs as normal website traffic (see DevDocs privacy policy).
- NodeForge does not send workspace source code to DevDocs—only search terms you explicitly select.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Blank Docs view | Check network; try **Open in browser** or set `preferExternal` |
| Wrong docset | Run **NodeForge: Analyze Workspace**, then **Open DevDocs for Workspace** |
| Docset missing on DevDocs | DevDocs may not list that tool; search by keyword instead |
