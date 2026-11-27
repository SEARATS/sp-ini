import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { readBlendPreview } from "./blend-export";
import { needsFbxReader, readFbx } from "./fbx-reader";
import { sceneHierarchy, hierarchy } from "./hierarchy";
import { fbxOutline } from "./model-outline";
import type { IniSource } from "./ini";
import type { EntityScene } from "./entity-model";
import { previewColors } from "./preview-colors";
import { meshFlagSetting } from "./mesh-flags";
import { isMissingTextureColor, type MissingTextureColor } from "./missing-textures";
import { readMeshTags } from "./mesh-sidecar";
import { editMeshTags, watchMeshTags } from "./mesh-tags-ui";
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

function registerObjPreview(context, entityRequest, onIndexChanged: vscode.Event<void>) {
  const dist = vscode.Uri.joinPath(context.extensionUri, "dist");
  const looseColorChanged = new vscode.EventEmitter<void>();
  context.subscriptions.push(looseColorChanged);
  let looseColor: MissingTextureColor;
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
    panel.webview.options = { enableScripts: true, localResourceRoots: [dist, vscode.workspace.getWorkspaceFolder(document.uri)?.uri ?? vscode.Uri.joinPath(document.uri, "..")] };
    let timer;
    const send = () => panel.webview.postMessage({ type:"model", sourceUri:document.uri.toString(), text:document.getText(), url:panel.webview.asWebviewUri(document.uri).toString() });
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
    showViewer(panel, document.uri);
    pair();
  }
  function showViewer(panel: vscode.WebviewPanel, uri: vscode.Uri, loading = "Opening model…") {
    const colorKey = "seapowerIni.missingTextureColor";
    const hasProject = () => !!(vscode.workspace.workspaceFolders?.length || vscode.workspace.workspaceFile);
    const sendColor = () => panel.webview.postMessage({type:"missingTextureColor", project:hasProject(),
      value:(!hasProject() && looseColor) || vscode.workspace.getConfiguration(undefined, uri).get(colorKey, "grey")});
    const looseChanges = looseColorChanged.event(() => { if (!hasProject()) void sendColor(); });
    const editable = uri.scheme === "file" && /\.(obj|fbx|blend)$/i.test(uri.path);
    const sendFlags = () => {
      let entries = [], error = "";
      try { if (editable) entries = [...readMeshTags(uri.fsPath)].map(([name, flags]) => [name, [...flags]]); }
      catch (e) { error = e.message; }
      return panel.webview.postMessage({ type:"meshFlags", editable, entries, error, rules:vscode.workspace.getConfiguration(undefined, uri).get(meshFlagSetting) });
    };
    const watcher = editable && watchMeshTags(uri, sendFlags);
    const ready = panel.webview.onDidReceiveMessage(async message => {
      if (message.type === "ready") { void sendFlags(); void sendColor(); }
      if (message.type === "setMissingTextureColor" && isMissingTextureColor(message.value)) {
        if (hasProject()) {
          const target = vscode.workspace.getWorkspaceFolder(uri) ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Workspace;
          try { await vscode.workspace.getConfiguration(undefined, uri).update(colorKey, message.value, target); }
          catch (error) { void vscode.window.showErrorMessage(error.message); }
        } else { looseColor = message.value; looseColorChanged.fire(); }
        void sendColor();
      }
      if (editable && message.type === "editMeshTags" && Array.isArray(message.names) && message.names.length &&
          message.names.every(name => typeof name === "string" && name.length)) {
        try { await editMeshTags(uri, message.names); await sendFlags(); }
        catch (error) { void vscode.window.showErrorMessage(error.message); }
      }
    });
    const changes = vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration(meshFlagSetting, uri)) void sendFlags();
      if (event.affectsConfiguration(colorKey, uri)) void sendColor();
    });
    panel.onDidDispose(() => { ready.dispose(); changes.dispose(); looseChanges.dispose(); if (watcher) watcher.dispose(); });
    const nonce = randomBytes(18).toString("base64");
    const script = panel.webview.asWebviewUri(vscode.Uri.joinPath(dist, "obj-viewer.js"));
    const icons = panel.webview.asWebviewUri(vscode.Uri.joinPath(dist, "codicon.css"));
    panel.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; font-src ${panel.webview.cspSource}; connect-src ${panel.webview.cspSource}; img-src ${panel.webview.cspSource} blob: data:">
      <link nonce="${nonce}" rel="stylesheet" href="${icons}">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style nonce="${nonce}">
      body { margin:0; overflow:hidden; background:var(--vscode-editor-background); color:var(--vscode-editor-foreground); }
      canvas { display:block; width:100vw; height:100vh; touch-action:none; }
      canvas.source-link { cursor:pointer; }
      #part-tip { position:fixed; pointer-events:none; white-space:pre-line; overflow-wrap:anywhere; max-width:min(32rem,95vw);
        max-height:85vh; overflow-y:auto;
        color:var(--vscode-editorHoverWidget-foreground); background:var(--vscode-editorHoverWidget-background);
        border:1px solid var(--vscode-editorHoverWidget-border); padding:5px 8px; z-index:2; }
      aside { position:absolute; bottom:10px; left:12px; max-width:85%; background:var(--vscode-editor-background); }
      #outline { position:absolute; top:8px; left:8px; max-width:min(42vw,30rem); max-height:70vh; overflow:auto;
        padding:5px 8px; background:var(--vscode-sideBar-background,var(--vscode-editor-background)); border:1px solid var(--vscode-panel-border); }
      summary { cursor:pointer; }
      summary:focus-visible { outline:1px solid var(--vscode-focusBorder); }
      #outline ul { margin:2px 0; padding-left:1.1em; list-style:none; }
      #outline > ul { padding-left:0; }
      #outline li { line-height:1.55; white-space:nowrap; }
      #outline li > span { padding-left:1em; }
      .selected-object { background:var(--vscode-list-activeSelectionBackground); color:var(--vscode-list-activeSelectionForeground); }
      #outline p { margin:4px 0; color:var(--vscode-descriptionForeground); }
      .row .edit-tags { padding:0 3px; background:transparent; color:inherit; opacity:0; }
      .row:hover .edit-tags, .row:focus-within .edit-tags { opacity:1; }
      .edit-tags[hidden] { display:none; }
      #entity-pickers label { display:grid; gap:2px; margin:4px 0; }
      #entity-warnings { max-width:28rem; white-space:normal; }
      #filters { display:grid; grid-template-columns:auto auto; align-items:center; gap:4px 8px; margin:6px 0; }
      #filters label, .row { display:inline-flex; align-items:center; gap:4px; }
      input[type=checkbox] { margin:0; accent-color:var(--vscode-focusBorder); }
      ${Object.entries(previewColors).map(([name,color])=>`.row.${name} { color:${color}; }`).join("\n")}
      select { color:var(--vscode-dropdown-foreground); background:var(--vscode-dropdown-background); }
      button { color:var(--vscode-button-foreground); background:var(--vscode-button-background); border:0; padding:5px 10px; cursor:pointer; }
      </style></head><body>
      <canvas aria-label="3D model"></canvas><aside><div id="arc-values" hidden></div><button hidden>Fit model</button> <span role="status">${loading}</span></aside>
      <div id="part-tip" role="tooltip" hidden></div>
      <details id="outline" open><summary>Model hierarchy</summary>
      <div id="entity-pickers" hidden><label>Entity<select id="entity"></select></label><div hidden><label><span id="appearance-label">Appearance</span><select id="appearance"></select></label></div><div id="model-sources"></div></div>
      <div id="filters"><label><input id="meshes" type="checkbox" checked>Meshes</label>
      <select id="meshWireframe" aria-label="Mesh render mode"><option value="shaded">Shaded</option><option value="wireframe">Wireframe</option></select>
      <label><input id="colliders" type="checkbox" checked>Colliders</label>
      <select id="colliderWireframe" aria-label="Collider render mode"><option value="shaded">Shaded</option><option value="wireframe" selected>Wireframe</option></select>
      <label for="missing-texture">Missing texture</label><select id="missing-texture"><option value="black">Black</option><option value="magenta">Magenta</option><option value="grey" selected>Grey</option></select>
      <div id="object-filter" hidden><label><input id="objects" type="checkbox" checked>Object markers</label></div>
      <div id="arc-filter" hidden><label><input id="arcs" type="checkbox" checked>System arcs</label></div></div>
      <p></p><p id="sidecar-error" role="status" hidden></p><details id="entity-warnings" hidden><summary></summary><div></div></details><ul></ul></details>
      <script nonce="${nonce}" src="${script}"></script></body></html>`;
  }
  const blendType = "seapower-ini.blend";
  const openBlend = vscode.commands.registerCommand("seapower-ini.previewBlend", (uri?: vscode.Uri) => {
    if (uri?.scheme === "file" && /\.blend$/i.test(uri.path)) return vscode.commands.executeCommand("vscode.openWith", uri, blendType);
  });
  function modelProvider(blend: boolean) {
    return vscode.window.registerCustomEditorProvider(blend ? blendType : "seapower-ini.fbx", {
      openCustomDocument(uri) { return { uri, dispose() {} }; },
      resolveCustomEditor(document, panel) {
        const folder = vscode.Uri.joinPath(document.uri, "..");
        const workspace = vscode.workspace.getWorkspaceFolder(document.uri);
        panel.webview.options = { enableScripts: true, localResourceRoots: [dist, workspace?.uri ?? folder] };
        let revision = 0;
        let conversion: AbortController | undefined, timer: ReturnType<typeof setTimeout>;
        const send = async (fallback = false) => {
          const current = ++revision;
          conversion?.abort();
          const message = { type: "fbx", sourceUri:document.uri.toString(), uri: blend ? undefined : document.uri.toString(), url: panel.webview.asWebviewUri(document.uri).toString() };
          try {
            if (blend && document.uri.scheme !== "file") throw Error("Open a local .blend file to preview it with Blender.");
            if (blend) conversion = new AbortController();
            const bytes = blend
              ? await readBlendPreview(document.uri.fsPath, vscode.workspace.getConfiguration("seapowerIni").get<string>("blenderPath"), conversion.signal)
              : await vscode.workspace.fs.readFile(document.uri);
            if (revision !== current) return;
            const file = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            const scene = blend || fallback || needsFbxReader(file) ? readFbx(file) : undefined;
            await panel.webview.postMessage({ ...message, revision: current, scene });
            if (revision === current) await panel.webview.postMessage({ type: "outline", nodes: fbxOutline(scene ? sceneHierarchy(scene) : hierarchy(file)) });
          } catch (error) {
            if (revision === current) await panel.webview.postMessage({ ...message, error: String(error), revision: current });
          }
        };
        const messages = panel.webview.onDidReceiveMessage(message => {
          if (message.type === "ready") void send();
          if (!blend && message.type === "fbxFallback" && message.revision === revision) void send(true);
        });
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, "*"));
        const refresh = (uri: vscode.Uri) => {
          if (uri.toString() !== document.uri.toString()) return;
          clearTimeout(timer);
          timer = setTimeout(() => void send(), 250);
        };
        watcher.onDidChange(refresh);
        watcher.onDidCreate(refresh);
        panel.onDidDispose(() => { revision++; conversion?.abort(); clearTimeout(timer); watcher.dispose(); messages.dispose(); });
        showViewer(panel, document.uri, blend ? "Opening scene in Blender…" : undefined);
      }
    }, {webviewOptions:{retainContextWhenHidden:blend}});
  }
  const entityType = "seapower-ini.entity";
  const openEntity = vscode.commands.registerCommand("seapower-ini.previewEntity", resource => {
    const uri = resource || vscode.window.activeTextEditor?.document.uri;
    if (uri && /\.ini$/i.test(uri.path)) return vscode.commands.executeCommand("vscode.openWith",uri,entityType,vscode.ViewColumn.Beside);
  });
  const entity = vscode.window.registerCustomEditorProvider(entityType, {
    resolveCustomTextEditor(document,panel) {
      panel.webview.options = {enableScripts:true,localResourceRoots:[dist]};
      let pending: vscode.CancellationTokenSource, timer, entity: string, appearance: string;
      let modelSources:Record<string,string> = {};
      let serial=0, sources = new Map<string,IniSource>();
      const stagedSources=new Map<number,Map<string,IniSource>>();
      function cancel() { pending?.cancel(); pending?.dispose(); pending = undefined; clearTimeout(timer); }
      async function reveal(ids: string[]) {
        const choices=ids.map(id=>sources.get(id)).filter(Boolean).map(source=>({label:"["+source.header+"]",source}));
        const source=(choices.length>1 ? await vscode.window.showQuickPick(choices,{placeHolder:"Open system definition"}) : choices[0])?.source;
        if (!source) return;
        const uri=vscode.Uri.parse(source.uri);
        const doc=await vscode.workspace.openTextDocument(uri);
        const header="["+source.header+"]";
        let line=source.line;
        if (line >= doc.lineCount || !doc.lineAt(line).text.trimStart().startsWith(header)) {
          const matches=doc.getText().split(/\r\n|\n|\r/).flatMap((s,i)=>s.trimStart().startsWith(header) ? [i] : []);
          if (!matches.length) { void vscode.window.showInformationMessage(header+" is no longer in this file."); return; }
          line=matches.reduce((a,b)=>Math.abs(a-source.line)<=Math.abs(b-source.line) ? a : b);
        }
        const start=doc.lineAt(line).firstNonWhitespaceCharacterIndex;
        const selection=new vscode.Range(line,start,line,start+header.length);
        const column=vscode.window.visibleTextEditors.find(e=>e.document.uri.toString()===uri.toString())?.viewColumn ||
          vscode.window.tabGroups.all.find(g=>g.viewColumn!==panel.viewColumn)?.viewColumn || vscode.ViewColumn.Beside;
        await vscode.window.showTextDocument(doc,{selection,viewColumn:column,preview:true});
      }
      async function update() {
        cancel();
        const source = pending = new vscode.CancellationTokenSource();
        const token = source.token;
        const request = {uri:document.uri.toString(),text:document.getText(),entity,appearance,modelSources};
        try {
          await panel.webview.postMessage({type:"entityLoading"});
          const choices = await entityRequest(request,token);
          if (token.isCancellationRequested) return;
          entity = choices.entity; appearance = choices.appearance;
          modelSources = Object.fromEntries((choices.modelSources ?? []).filter(c=>c.selected).map(c=>[c.key,c.selected]));
          await panel.webview.postMessage({type:"entityChoices",...choices});
          const scene: EntityScene = await entityRequest({...request,entity,appearance,modelSources,render:true},token);
          if (token.isCancellationRequested) return;
          const version=++serial;
          const next=new Map<string,IniSource>();
          for (const part of [...scene.parts,...(scene.objects || [])]) if (part.source) next.set(part.id,part.source);
          stagedSources.set(version,next);
          if (!await panel.webview.postMessage({type:"entityScene",scene,entity,version,documentUri:request.uri})) stagedSources.delete(version);
        } catch (error) {
          if (!token.isCancellationRequested) await panel.webview.postMessage({type:"entityError",message:error.message});
        }
      }
      const messages = panel.webview.onDidReceiveMessage(message => {
        if (message.type === "entityRendered") {
          const next=stagedSources.get(message.version);
          if (message.applied && next) sources=next;
          stagedSources.delete(message.version);
          return;
        }
        if (message.type === "openEntityPart") {
          if (Array.isArray(message.ids)) void reveal(message.ids).catch(e=>vscode.window.showErrorMessage(e.message));
          return;
        }
        if (message.type !== "ready" && message.type !== "selectEntity") return;
        entity = message.entity; appearance = message.appearance; modelSources = message.modelSources ?? {};
        void update();
      });
      const edits = vscode.workspace.onDidChangeTextDocument(event=>{
        if (event.document !== document || !event.contentChanges.length) return;
        cancel(); timer = setTimeout(update,350);
      });
      const indexed = onIndexChanged(()=>void update());
      panel.onDidDispose(()=>{cancel();messages.dispose();edits.dispose();indexed.dispose();});
      showViewer(panel, document.uri);
    }
  });
  return vscode.Disposable.from(command, openSource, openBlend, modelProvider(false), modelProvider(true), openEntity, entity, vscode.window.registerCustomEditorProvider(viewType, { resolveCustomTextEditor }));
}

export { registerObjPreview };
