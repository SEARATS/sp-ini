const { randomBytes } = require("node:crypto");
const vscode = require("vscode");
const viewType = "seapower-ini.obj";

function openSourceBeside(document, column) {
  if (!vscode.workspace.getConfiguration("seapowerIni", document.uri).get("obj.openSourceBeside")) return;
  const others = vscode.window.tabGroups.all.filter(group => group.viewColumn !== column);
  const source = others.find(group => group.tabs.some(({ input }) =>
    input instanceof vscode.TabInputText && input.uri.toString() === document.uri.toString()));
  const neighbor = others.sort((a, b) => Math.abs(a.viewColumn - column) - Math.abs(b.viewColumn - column))[0];
  return vscode.commands.executeCommand("vscode.openWith", document.uri, "default", {
    viewColumn: (source || neighbor)?.viewColumn ?? vscode.ViewColumn.Beside, preserveFocus: true
  });
}

function registerObjPreview(context) {
  const dist = vscode.Uri.joinPath(context.extensionUri, "dist");
  const command = vscode.commands.registerCommand("seapower-ini.previewObj", resource => {
    const uri = resource || vscode.window.tabGroups.activeTabGroup.activeTab?.input?.uri;
    if (uri && /\.obj$/i.test(uri.path)) return vscode.commands.executeCommand("vscode.openWith", uri, viewType, vscode.ViewColumn.Beside);
  });
  function resolveCustomTextEditor(document, panel) {
    panel.webview.options = { enableScripts: true, localResourceRoots: [dist] };
    let timer;
    const send = () => panel.webview.postMessage({ type: "model", text: document.getText() });
    const messages = panel.webview.onDidReceiveMessage(message => { if (message.type === "ready") send(); });
    let paired = false;
    function pair() {
      if (paired || !panel.visible || !panel.viewColumn) return;
      paired = true;
      openSourceBeside(document, panel.viewColumn)?.then(undefined, error => vscode.window.showErrorMessage(error.message));
    }
    const visibility = panel.onDidChangeViewState(pair);
    const edits = vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document !== document || !event.contentChanges.length) return;
      clearTimeout(timer);
      timer = setTimeout(send, 350);
    });
    panel.onDidDispose(() => {
      clearTimeout(timer);
      messages.dispose();
      visibility.dispose();
      edits.dispose();
    });
    const nonce = randomBytes(18).toString("base64");
    const script = panel.webview.asWebviewUri(vscode.Uri.joinPath(dist, "obj-viewer.js"));
    panel.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style nonce="${nonce}">
      body { margin:0; overflow:hidden; background:var(--vscode-editor-background); color:var(--vscode-editor-foreground); }
      canvas { display:block; width:100vw; height:100vh; touch-action:none; }
      aside { position:absolute; top:10px; left:12px; max-width:85%; background:var(--vscode-editor-background); }
      button { color:var(--vscode-button-foreground); background:var(--vscode-button-background); border:0; padding:5px 10px; cursor:pointer; }
      </style></head><body>
      <canvas aria-label="3D model"></canvas><aside><button hidden>Fit model</button> <span role="status">Opening model…</span></aside>
      <script nonce="${nonce}" src="${script}"></script></body></html>`;
    pair();
  }
  return vscode.Disposable.from(command, vscode.window.registerCustomEditorProvider(viewType, { resolveCustomTextEditor }));
}

module.exports = { registerObjPreview };
