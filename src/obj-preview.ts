import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
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
  const openSource = vscode.commands.registerCommand("seapower-ini.openObjSource", async (url, line, column) => {
    const uri = vscode.Uri.parse(url);
    if (uri.scheme !== "file" || !/\.obj$/i.test(uri.path)) return;
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { selection: new vscode.Range(line, column, line, column), preview: true });
  });
  const command = vscode.commands.registerCommand("seapower-ini.previewObj", resource => {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const uri = resource || (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom ? input.uri : undefined);
    if (uri && /\.obj$/i.test(uri.path)) return vscode.commands.executeCommand("vscode.openWith", uri, viewType, vscode.ViewColumn.Beside);
  });
  function resolveCustomTextEditor(document, panel) {
    // Definition navigation must open source even when OBJ defaults to the 3D editor.
    const target = /^sp-ini-source=(\d+),(\d+),(\d+)$/.exec(document.uri.fragment);
    if (target) {
      const [, line, start, end] = target.map(Number);
      const selection = new vscode.Range(line, start, line, end);
      const column = panel.viewColumn;
      setImmediate(async () => {
        try {
          const source = await vscode.workspace.openTextDocument(document.uri.with({ fragment: "" }));
          await vscode.window.showTextDocument(source, { viewColumn: column, selection, preview: true });
        } catch (error) {
          vscode.window.showErrorMessage("Could not open OBJ source: " + error.message);
        } finally { panel.dispose(); }
      });
      return;
    }
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
    showViewer(panel);
    pair();
  }
  function showViewer(panel) {
    const nonce = randomBytes(18).toString("base64");
    const script = panel.webview.asWebviewUri(vscode.Uri.joinPath(dist, "obj-viewer.js"));
    panel.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src ${panel.webview.cspSource}; img-src ${panel.webview.cspSource} blob: data:">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style nonce="${nonce}">
      body { margin:0; overflow:hidden; background:var(--vscode-editor-background); color:var(--vscode-editor-foreground); }
      canvas { display:block; width:100vw; height:100vh; touch-action:none; }
      aside { position:absolute; top:10px; left:12px; max-width:85%; background:var(--vscode-editor-background); }
      button { color:var(--vscode-button-foreground); background:var(--vscode-button-background); border:0; padding:5px 10px; cursor:pointer; }
      </style></head><body>
      <canvas aria-label="3D model"></canvas><aside><button hidden>Fit model</button> <span role="status">Opening model…</span></aside>
      <script nonce="${nonce}" src="${script}"></script></body></html>`;
  }
  const fbx = vscode.window.registerCustomEditorProvider("seapower-ini.fbx", {
    openCustomDocument(uri) { return { uri, dispose() {} }; },
    resolveCustomEditor(document, panel) {
      const folder = vscode.Uri.joinPath(document.uri, "..");
      panel.webview.options = { enableScripts: true, localResourceRoots: [dist, folder] };
      const send = () => panel.webview.postMessage({ type: "fbx", url: panel.webview.asWebviewUri(document.uri).toString() });
      const messages = panel.webview.onDidReceiveMessage(message => { if (message.type === "ready") send(); });
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, "*"));
      const changes = watcher.onDidChange(uri => { if (uri.toString() === document.uri.toString()) send(); });
      panel.onDidDispose(() => { changes.dispose(); watcher.dispose(); messages.dispose(); });
      showViewer(panel);
    }
  });
  return vscode.Disposable.from(command, openSource, fbx, vscode.window.registerCustomEditorProvider(viewType, { resolveCustomTextEditor }));
}

export { registerObjPreview };
