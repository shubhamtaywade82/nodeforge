# DevDocs.io integration

NodeForge integrates **[DevDocs.io](https://devdocs.io)** in two modes:

1. **Online** — embedded sidebar (iframe) and browser deep-links  
2. **Offline** — download docsets into extension storage, search locally, open HTML in-editor

DevDocs is a third-party documentation aggregator. NodeForge downloads official archives from `downloads.devdocs.io` and does not republish or scrape arbitrary sites.

## Online (default)

| Feature | Description |
|---------|-------------|
| **Docs sidebar** | Webview iframe to `https://devdocs.io` |
| **Workspace-aware entry** | Opens a docset matching the detected stack |
| **Search selection** | **NodeForge: Search DevDocs** (context menu or palette) |

Setting `nodeforge.docs.preferExternal` opens links in the system browser instead of the sidebar.

## Offline docset sync

| Feature | Description |
|---------|-------------|
| **Sync command** | **NodeForge: Sync DevDocs Offline** (Docs view toolbar or palette) |
| **Storage** | `globalStorage/devdocs/{slug}/` — HTML + `db.json` from official `.tar.gz` |
| **Updates** | Skips download when local `mtime` matches [docs.json](https://devdocs.io/docs.json) |
| **Search** | **Search DevDocs** uses offline index first when `preferOfflineSearch` is true |
| **Open results** | Quick Pick → local HTML in a side panel (no network) |

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `nodeforge.docs.offline.autoSync` | `false` | After workspace analyze, sync docsets for detected stack (can use significant bandwidth/disk) |
| `nodeforge.docs.offline.preferOfflineSearch` | `true` | Prefer local search before online `#q=` search |
| `nodeforge.docs.offline.extraSlugs` | `[]` | Extra slugs to sync (e.g. `react`, `express`) |

### Which docsets sync?

`@nodeforge/core` → `suggestDevDocsSlugs(profile)` (JavaScript, TypeScript, Node, npm/pnpm/yarn, ESLint, Jest/Vitest, Docker, …) plus `extraSlugs`. Slugs not in the DevDocs catalog are reported as failed in the sync summary.

### Disk and network

Each docset is typically **1–10+ MB** compressed. Syncing the full suggested set for a TS monorepo may download tens of megabytes. Use manual sync first; enable `autoSync` only if you want always-fresh offline docs.

## Architecture

```
extension (DevDocsOfflineManager)
    → @nodeforge/adapter-devdocs (DevDocsSyncAdapter)
        → fetch downloads.devdocs.io
        → ProcessRunner: tar -xzf
        → searchDb.ts (pure search over db.json)
```

## Commands

- `NodeForge: Open DevDocs Home`
- `NodeForge: Open DevDocs for Workspace`
- `NodeForge: Search DevDocs`
- `NodeForge: Sync DevDocs Offline`

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Sync fails for a slug | Slug may be missing from DevDocs; remove from `extraSlugs` |
| `tar` not found | Install GNU tar (required for extract on Linux/macOS/WSL) |
| Offline search empty | Run **Sync DevDocs Offline** first |
| Blank online Docs view | Network / iframe; use **preferExternal** or offline sync |

## Privacy

Online mode loads DevDocs like a normal browser tab. Offline mode only fetches public docset archives; your source code is not sent to DevDocs.
