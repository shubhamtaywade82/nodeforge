import * as vscode from "vscode";

export function openOfflineDocPanel(
  context: vscode.ExtensionContext,
  htmlPath: string,
  title: string
): void {
  const panel = vscode.window.createWebviewPanel(
    "nodeforgeDevDocsOffline",
    `Docs: ${title}`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: false,
      localResourceRoots: [vscode.Uri.file(htmlPath), context.globalStorageUri]
    }
  );

  const uri = panel.webview.asWebviewUri(vscode.Uri.file(htmlPath));
  panel.webview.html = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${panel.webview.cspSource}; style-src ${panel.webview.cspSource} 'unsafe-inline'; img-src ${panel.webview.cspSource} data:;" />
<style>html,body,iframe{margin:0;padding:0;height:100%;width:100%;border:0;}</style>
</head>
<body><iframe src="${uri}" title="${title}"></iframe></body></html>`;
}
