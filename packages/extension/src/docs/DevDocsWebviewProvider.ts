import * as vscode from "vscode";
import type { WorkspaceProfile } from "@nodeforge/contracts";
import { buildDevDocsUrl, devDocsDefaultSlug, DEVDOCS_HOME_URL } from "@nodeforge/core";

export class DevDocsWebviewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private profile: WorkspaceProfile | undefined;
  private currentUrl = DEVDOCS_HOME_URL;

  constructor(private readonly extensionUri: vscode.Uri) {}

  setProfile(profile: WorkspaceProfile | undefined): void {
    this.profile = profile;
    if (profile) {
      const slug = devDocsDefaultSlug(profile);
      this.navigate(buildDevDocsUrl({ slug }));
    }
  }

  navigate(url: string): void {
    this.currentUrl = url;
    this.view?.webview.postMessage({ type: "navigate", url });
    if (this.view) {
      this.view.webview.html = this.getHtml(this.view.webview, url);
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    const startUrl = this.profile
      ? buildDevDocsUrl({ slug: devDocsDefaultSlug(this.profile) })
      : this.currentUrl;
    webviewView.webview.html = this.getHtml(webviewView.webview, startUrl);

    webviewView.webview.onDidReceiveMessage((message: { type: string }) => {
      if (message.type === "openExternal") {
        void vscode.env.openExternal(vscode.Uri.parse(this.currentUrl));
      }
    });
  }

  private getHtml(webview: vscode.Webview, iframeUrl: string): string {
    const nonce = getNonce();
    const escaped = iframeUrl.replace(/"/g, "&quot;");
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src https://devdocs.io; script-src 'nonce-${nonce}'; style-src ${webview.cspSource};" />
  <style>
    html, body { margin: 0; padding: 0; height: 100%; background: var(--vscode-editor-background); }
    iframe { border: 0; width: 100%; height: calc(100% - 36px); }
    .bar {
      display: flex; align-items: center; justify-content: space-between;
      height: 36px; padding: 0 8px; font-family: var(--vscode-font-family);
      font-size: 11px; color: var(--vscode-descriptionForeground);
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    button {
      border: none; background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground); border-radius: 4px;
      padding: 4px 8px; cursor: pointer; font-size: 11px;
    }
  </style>
</head>
<body>
  <div class="bar">
    <span>DevDocs.io (embedded)</span>
    <button id="external">Open in browser</button>
  </div>
  <iframe id="frame" src="${escaped}" title="DevDocs documentation"></iframe>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('external').addEventListener('click', () => {
      vscode.postMessage({ type: 'openExternal' });
    });
    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'navigate' && e.data.url) {
        document.getElementById('frame').src = e.data.url;
      }
    });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}
