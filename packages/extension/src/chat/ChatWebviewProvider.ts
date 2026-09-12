import * as vscode from "vscode";
import { ChatController, type ChatControllerConfig } from "./ChatController.js";
import type { ExtensionWorkspaceSession } from "../core/ExtensionWorkspaceSession.js";

const CHAT_API_KEY_SECRET = "nodeforge.chat.apiKey";

export class ChatWebviewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly session: ExtensionWorkspaceSession,
    private readonly controller: ChatController,
    private readonly isTrusted: () => boolean
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")]
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message: { type: string; text?: string }) => {
      if (message.type === "ready") {
        await this.postInit();
        this.postWelcome();
        return;
      }
      if (message.type === "cancel") {
        this.controller.cancel();
        return;
      }
      if (message.type === "send" && message.text) {
        await this.handleSend(message.text);
      }
    });
  }

  clearChat(): void {
    this.controller.clearHistory();
    this.view?.webview.postMessage({ type: "clear" });
    this.postWelcome();
  }

  private async postInit(): Promise<void> {
    const config = this.readConfig();
    const hasApiKey = Boolean(await this.context.secrets.get(CHAT_API_KEY_SECRET));
    this.view?.webview.postMessage({
      type: "init",
      model: config.model,
      trusted: this.isTrusted(),
      hasApiKey
    });
  }

  private postWelcome(): void {
    const trusted = this.isTrusted();
    const trustNote = trusted
      ? "Workspace is **trusted** — write tools (format, fix, scripts) are enabled."
      : "Workspace is **restricted** — write tools are blocked until you trust this folder.";
    this.view?.webview.postMessage({
      type: "welcome",
      text: `**NodeForge** is your engineering copilot for this repo.\n\n${trustNote}\n\nUse the chips below or ask in plain language. Slash workflows: \`/audit-and-upgrade-deps\`, \`/validate-and-fix\`, \`/onboard-to-project\`, \`/explain-errors\`.`
    });
  }

  private async handleSend(text: string): Promise<void> {
    const config = this.readConfig();
    await this.controller.runUserMessage(text, config, {
      onAssistantDelta: (delta) => {
        this.view?.webview.postMessage({ type: "assistantDelta", text: delta });
      },
      onToolStart: (name) => {
        this.view?.webview.postMessage({ type: "toolStart", name });
      },
      onToolEnd: (record) => {
        this.view?.webview.postMessage({
          type: "toolEnd",
          name: record.name,
          ok: record.ok,
          durationMs: record.durationMs,
          preview: previewToolResult(record.result)
        });
      },
      onDone: () => {
        this.view?.webview.postMessage({ type: "done" });
      },
      onError: (message) => {
        this.view?.webview.postMessage({ type: "error", message });
      }
    });
  }

  private readConfig(): ChatControllerConfig {
    const cfg = vscode.workspace.getConfiguration("nodeforge.chat");
    return {
      baseUrl: cfg.get<string>("baseUrl", "https://api.openai.com/v1"),
      model: cfg.get<string>("model", "gpt-4o-mini"),
      maxToolRounds: cfg.get<number>("maxToolRounds", 8),
      injectWorkspaceSnapshot: cfg.get<boolean>("injectWorkspaceSnapshot", true)
    };
  }

  private getHtml(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "chat", "chat.css"));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "chat", "chat.js"));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <header id="header">
    <div>
      <div class="title">NodeForge Chat</div>
      <div class="subtitle">Engineering assistant</div>
    </div>
    <div id="status-pills">
      <span class="pill" id="pill-model">…</span>
      <span class="pill" id="pill-trust">…</span>
      <span class="pill" id="pill-key">…</span>
    </div>
  </header>
  <div id="messages"></div>
  <div id="thinking" class="thinking">
    <span>Thinking</span>
    <span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>
  </div>
  <div id="chips">
    <button class="chip" data-cmd="/onboard-to-project">Onboard</button>
    <button class="chip" data-cmd="/audit-and-upgrade-deps">Audit deps</button>
    <button class="chip" data-cmd="/validate-and-fix">Validate</button>
    <button class="chip" data-cmd="/explain-errors">Explain errors</button>
  </div>
  <div id="composer">
    <textarea id="input" rows="2" placeholder="Ask NodeForge… (Shift+Enter for newline)"></textarea>
    <div id="composer-actions">
      <button id="send">Send</button>
      <button id="cancel" class="secondary" disabled>Stop</button>
    </div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function previewToolResult(result: string): string {
  const max = 1200;
  if (result.length <= max) return result;
  return `${result.slice(0, max)}\n…`;
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}
