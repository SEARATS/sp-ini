import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { hierarchy } from "./hierarchy";
import { fbxOutline } from "./model-outline";
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
      aside { position:absolute; bottom:10px; left:12px; max-width:85%; background:var(--vscode-editor-background); }
      #outline { position:absolute; top:8px; left:8px; max-width:min(42vw,30rem); max-height:70vh; overflow:auto;
        padding:5px 8px; background:var(--vscode-sideBar-background,var(--vscode-editor-background)); border:1px solid var(--vscode-panel-border); }
      summary { cursor:pointer; }
      summary:focus-visible { outline:1px solid var(--vscode-focusBorder); }
      #outline ul { margin:2px 0; padding-left:1.1em; list-style:none; }
      #outline > ul { padding-left:0; }
      #outline li { line-height:1.55; white-space:nowrap; }
      #outline li > span { padding-left:1em; }
      #outline p { margin:4px 0; color:var(--vscode-descriptionForeground); }
      #filters { display:grid; grid-template-columns:auto auto; align-items:center; gap:4px 8px; margin:6px 0; }
      #filters label, .row { display:inline-flex; align-items:center; gap:4px; }
      input[type=checkbox] { margin:0; accent-color:var(--vscode-focusBorder); }
      .collider-icon { width:1em; height:1em; color:var(--vscode-charts-orange); vertical-align:middle; }
      select { color:var(--vscode-dropdown-foreground); background:var(--vscode-dropdown-background); }
      button { color:var(--vscode-button-foreground); background:var(--vscode-button-background); border:0; padding:5px 10px; cursor:pointer; }
      </style></head><body>
      <canvas aria-label="3D model"></canvas><aside><button hidden>Fit model</button> <span role="status">Opening model…</span></aside>
      <details id="outline" open><summary>Model hierarchy</summary>
      <div id="filters"><label><input id="meshes" type="checkbox" checked>Meshes</label>
      <select id="meshWireframe" aria-label="Mesh render mode"><option value="shaded">Shaded</option><option value="wireframe">Wireframe</option></select>
      <label><input id="colliders" type="checkbox" checked>Colliders</label>
      <select id="colliderWireframe" aria-label="Collider render mode"><option value="shaded">Shaded</option><option value="wireframe" selected>Wireframe</option></select></div>
      <p></p><ul></ul></details>
      <template id="box"><svg class="collider-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linejoin="round" role="img" aria-label="Likely collider"><title>Likely collider</title><path d="M8 1 14.5 4.5v7L8 15l-6.5-3.5v-7z M1.5 4.5 8 8l6.5-3.5 M8 8v7"/></svg></template>
      <script nonce="${nonce}" src="${script}"></script></body></html>`;
  }
  const fbx = vscode.window.registerCustomEditorProvider("seapower-ini.fbx", {
    openCustomDocument(uri) { return { uri, dispose() {} }; },
    resolveCustomEditor(document, panel) {
      const folder = vscode.Uri.joinPath(document.uri, "..");
      panel.webview.options = { enableScripts: true, localResourceRoots: [dist, folder] };
      let revision = 0;
      const send = async () => {
        const current = ++revision;
        const message = { type: "fbx", uri: document.uri.toString(), url: panel.webview.asWebviewUri(document.uri).toString() };
        await panel.webview.postMessage(message);
        try {
          const bytes = await vscode.workspace.fs.readFile(document.uri);
          if (revision !== current) return;
          await panel.webview.postMessage({ type: "outline", nodes: fbxOutline(hierarchy(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))) });
        } catch (error) {
          if (revision === current) await panel.webview.postMessage({ type: "outline", error: String(error) });
        }
      };
      const messages = panel.webview.onDidReceiveMessage(message => { if (message.type === "ready") send(); });
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, "*"));
      const changes = watcher.onDidChange(uri => { if (uri.toString() === document.uri.toString()) send(); });
      panel.onDidDispose(() => { revision++; changes.dispose(); watcher.dispose(); messages.dispose(); });
      showViewer(panel);
    }
  });
  return vscode.Disposable.from(command, openSource, fbx, vscode.window.registerCustomEditorProvider(viewType, { resolveCustomTextEditor }));
}

export { registerObjPreview };
