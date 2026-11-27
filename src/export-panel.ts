import * as vscode from "vscode";
import { basename, dirname, extname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { readBlendPreview } from "./blend-export";
import { changes, sceneHierarchy } from "./hierarchy";
import { readFbx } from "./fbx-reader";
import { modelTags } from "./model-tags";
import { specialRoles } from "./export-roles";
import { exportCategories, exportRows, objExportHierarchy, planExport, type ExportCategory, type ExportChoice } from "./export-plan";
import { readMeshOverrides } from "./mesh-sidecar";
import { orderHierarchy } from "./mesh-order";
import { editMeshTags, moveMeshInList, saveMeshTagChanges, watchMeshTags } from "./mesh-tags-ui";
import { meshFlagSetting } from "./mesh-flags";
import { exportRigAssets, type RigAssets } from "./export-rig";

export async function openExportPanel(context: vscode.ExtensionContext, uri: vscode.Uri) {
  if (uri.scheme !== "file" || !/\.(fbx|obj|blend)$/i.test(uri.path)) throw Error("Choose an OBJ, FBX or Blender file.");
  const name = basename(uri.fsPath);
  const source = await vscode.window.withProgress({location:vscode.ProgressLocation.Notification, title:"Reading " + name, cancellable:true}, async (_, token) => {
    const controller = new AbortController();
    const cancellation = token.onCancellationRequested(() => controller.abort());
    try {
      const dirty = vscode.workspace.textDocuments.find(doc => doc.isDirty && doc.uri.toString() === uri.toString());
      const bytes = /\.blend$/i.test(name)
        ? await readBlendPreview(uri.fsPath, vscode.workspace.getConfiguration("seapowerIni", uri).get("blenderPath"), controller.signal)
        : dirty ? Buffer.from(dirty.getText()) : Buffer.from(await vscode.workspace.fs.readFile(uri));
      if (token.isCancellationRequested) return;
      const roots = /\.obj$/i.test(name) ? objExportHierarchy(bytes.toString("utf8"), new Map()) : sceneHierarchy(readFbx(bytes,"counts"));
      return {roots, bytes};
    } catch (error) { if (!token.isCancellationRequested) throw error; }
    finally { cancellation.dispose(); }
  });
  if (!source) return;
  let roots = source.roots;
  let rigAssets: RigAssets;
  const rigPreference = "export.showRig";
  const readRows = () => {
    const rules = vscode.workspace.getConfiguration(undefined,uri).get(meshFlagSetting);
    const {order,tags} = readMeshOverrides(uri.fsPath);
    roots = orderHierarchy(source.roots,order);
    return exportRows(roots,modelTags(source.roots,name,tags,rules),rules);
  };
  let rows = readRows(), byPath = new Map(rows.map(row => [row.path,row]));
  const dist = vscode.Uri.joinPath(context.extensionUri, "dist");
  const panel = vscode.window.createWebviewPanel("seapower-ini.export", "Export INI · " + name, vscode.ViewColumn.Active,
    {enableScripts:true, retainContextWhenHidden:true, localResourceRoots:[dist]});
  const web = panel.webview;
  let target: vscode.TextDocument, targetVersion: number, generation = 0, request = 0;
  let plan: ReturnType<typeof planExport>;
  let enabled = new Set<ExportCategory>(exportCategories);
  const roles = new Map<string, ExportChoice>();
  let distances: number[] = [];
  function refresh() {
    generation++;
    plan = undefined;
    const before = target?.getText();
    targetVersion = target?.version;
    let preview = "", error = "";
    try {
      const choices = new Map(rows.map(row => [row.path, roles.get(row.path) ?? row.category]));
      plan = planExport(name, roots, enabled, choices, before, distances);
      if (plan.count) preview = target ? changes(basename(target.fileName), before, plan.after) : plan.text;
    } catch (e) { error = e.message; }
    void web.postMessage({type:"preview", generation, request, preview, error, target:target?.fileName, rigIni:target ? plan?.text ?? "" : undefined,
      count:plan?.count ?? 0, note:plan?.note, changed:!target || (plan && before !== plan.after)});
  }
  const edits = vscode.workspace.onDidChangeTextDocument(e => { if (e.document === target) refresh(); });
  function updateTags() {
    try {
      rows = readRows();
      byPath = new Map(rows.map(row => [row.path,row]));
      void web.postMessage({type:"tags",rows});
      refresh();
    } catch (error) { void vscode.window.showErrorMessage(error.message); }
  }
  const watcher = watchMeshTags(uri, updateTags);
  const settings = vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration(meshFlagSetting,uri)) updateTags(); });
  panel.onDidDispose(() => { edits.dispose(); watcher.dispose(); settings.dispose(); });
  web.onDidReceiveMessage(async message => {
    try {
      if (message.type === "ready") {
        await web.postMessage({type:"model", rows, categories:exportCategories, showRig:context.workspaceState.get(rigPreference,true)});
        refresh();
      } else if (message.type === "moveMesh") {
        moveMeshInList(uri,message);
        updateTags();
      } else if (message.type === "addTags" || message.type === "removeTag") {
        const row = byPath.get(message.path);
        if (!row?.mesh) return;
        if (message.type === "addTags") await editMeshTags(uri,[row.mesh,row.name],row.tags,row.name,"add");
        else if (row.tags.includes(message.tag)) saveMeshTagChanges(uri,row.mesh,row.name,new Map([[message.tag,false]]));
        updateTags();
      } else if (message.type === "rigAssets") {
        try {
          rigAssets ??= exportRigAssets(name, source.bytes);
          source.bytes = undefined;
          await web.postMessage({type:"rigAssets", assets:rigAssets});
        } catch (error) { await web.postMessage({type:"rigAssets", error:error.message}); }
      } else if (message.type === "showRig" && typeof message.visible === "boolean") {
        await context.workspaceState.update(rigPreference,message.visible);
      } else if (message.type === "selection") {
        if (!Array.isArray(message.categories) || !Array.isArray(message.roles)) return;
        enabled = new Set(exportCategories.filter(c => message.categories.includes(c)));
        roles.clear();
        for (const [path, role] of message.roles) {
          const row = byPath.get(path);
          if (row && (role === "Skip" || role === "Helper" || (row.mesh && (exportCategories.includes(role) || specialRoles.includes(role))))) roles.set(path, role);
        }
        distances = Array.isArray(message.distances) ? message.distances.map(d => typeof d === "number" ? d : NaN) : [];
        request = message.request;
        refresh();
      } else if (message.type === "target") {
        const result = await vscode.window.showOpenDialog({openLabel:"Review changes to INI", filters:{INI:["ini"]}});
        if (result?.length) {
          if (!/\.ini$/i.test(result[0].path)) throw Error("Choose an INI file.");
          target = await vscode.workspace.openTextDocument(result[0]);
          refresh();
        }
      } else if (message.type === "clearTarget") {
        target = undefined;
        refresh();
      } else if (message.generation === generation && plan?.count) {
        if (message.type === "copy" && !target) {
          await vscode.env.clipboard.writeText(plan.text);
          void vscode.window.showInformationMessage("Copied generated INI.");
        } else if (message.type === "save" && !target) {
          const suffix = enabled.size === 1 && enabled.has("Collider") ? "_colliders.ini" : ".ini";
          const destination = await vscode.window.showSaveDialog({defaultUri:vscode.Uri.file(join(dirname(uri.fsPath),basename(name,extname(name)) + suffix)), filters:{INI:["ini"]}});
          if (destination && message.generation === generation) {
            if (!/\.ini$/i.test(destination.path)) throw Error("Choose an INI file.");
            if (vscode.workspace.textDocuments.some(doc => doc.isDirty && doc.uri.toString() === destination.toString())) throw Error("Save your edits to the destination INI first.");
            await vscode.workspace.fs.writeFile(destination, Buffer.from(plan.text));
          }
        } else if (message.type === "new" && !target) {
          await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({language:"seapower-ini", content:plan.text}));
        } else if (message.type === "apply" && target) {
          if (target.isClosed || target.version !== targetVersion) {
            target = await vscode.workspace.openTextDocument(target.uri);
            refresh();
            return;
          }
          const doc = target, edit = new vscode.WorkspaceEdit();
          edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), plan.after);
          if (!await vscode.workspace.applyEdit(edit)) throw Error("Could not apply the reviewed changes.");
          await vscode.window.showTextDocument(doc);
        }
      }
    } catch (e) { void vscode.window.showErrorMessage(e.message); }
  });
  const nonce = randomBytes(18).toString("base64");
  const script = web.asWebviewUri(vscode.Uri.joinPath(dist, "export-viewer.js"));
  web.html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style nonce="${nonce}">
  *{box-sizing:border-box} body{display:grid;grid-template-rows:auto minmax(0,1fr) auto;height:100vh;margin:0;padding:16px;gap:12px}
  header,footer,.categories{display:flex;align-items:center;gap:12px;flex-wrap:wrap} h2{font-size:1em;margin:0 0 8px}
  .preview-heading{display:flex;align-items:center;gap:8px;margin-bottom:8px}.preview-heading h2{margin:0}
  main{display:grid;grid-template-columns:minmax(260px,1fr) minmax(300px,1.35fr);gap:16px;min-height:0}
  section{min-width:0;min-height:0;display:flex;flex-direction:column} #objects,pre{overflow:auto;border:1px solid var(--vscode-panel-border);margin:0;flex:1}
  .row{display:flex;align-items:center;gap:8px;padding:4px 8px}.row:nth-child(even){background:var(--vscode-list-hoverBackground)}
  .row>span{flex:1;overflow-wrap:anywhere}.off>span{color:var(--vscode-descriptionForeground)}
  #objects{container-type:inline-size}.tags,.tag-list{display:flex;align-items:center;gap:3px;justify-content:flex-end}
  .tags{max-width:38%;min-width:0}.tag-list{min-width:0;flex-wrap:wrap}.tags[hidden],.tag-list:empty{display:none}
  .tag-chip{display:inline-flex;align-items:center;max-width:100%;padding-left:5px;border-radius:4px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);font-size:.9em}
  .tag-chip span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tags button{background:transparent;color:inherit;padding:1px 4px;font:inherit}.tag-chip button{opacity:0;flex:none}
  .tag-chip:hover button,.tag-chip:focus-within button{opacity:1}.tags button:focus-visible{outline:1px solid var(--vscode-focusBorder)}
  .tags .add-tag{font-size:1.15em}.add-tag:hover{background:var(--vscode-toolbar-hoverBackground)}
  @media(hover:none){.tag-chip button{opacity:1}}
  .moves{display:inline-flex;gap:1px}.moves button{padding:1px 3px}
  @container(max-width:440px){.row{gap:4px}.row select{max-width:32%}.row>span{min-width:3em;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}}
  #lod-settings label{white-space:nowrap}#lod-settings input{width:5em}#lod-settings:empty{display:none}
  input,select{accent-color:var(--vscode-focusBorder)} select{color:var(--vscode-dropdown-foreground);background:var(--vscode-dropdown-background)}
  pre{padding:12px;font-family:var(--vscode-editor-font-family);user-select:text} #status{color:var(--vscode-descriptionForeground)}
  button{border:0;padding:6px 10px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);cursor:pointer}
  button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}button:disabled{opacity:.5;cursor:default}
  #targetName{overflow-wrap:anywhere}
  #rig{margin-bottom:8px} #rig summary{cursor:pointer;font-weight:600;padding:3px 0}
  #rig-view{position:relative;height:clamp(110px,31vh,420px);border:1px solid var(--vscode-panel-border)}
  #rig canvas{display:block;width:100%;height:100%;touch-action:none} #rig-tools{position:absolute;bottom:5px;left:5px;display:flex;gap:8px;align-items:center;background:var(--vscode-editor-background)}
  #rig-note{position:absolute;top:4px;left:6px;max-width:95%;max-height:45%;overflow:auto;white-space:pre-line;background:var(--vscode-editor-background)}
  @media(max-width:620px){main{grid-template-columns:1fr;grid-template-rows:minmax(75px,1fr) minmax(180px,2fr)} #rig-view{height:clamp(85px,21vh,180px)}}
  </style></head><body><header><strong>Export categories</strong><div class="categories"></div><button id="only-colliders">Colliders only</button><div id="lod-settings" class="categories"></div></header>
  <main><section><h2>Objects</h2><div id="objects"></div></section><section>
  <details id="rig"><summary>Rig preview</summary><div id="rig-view"><canvas aria-label="Exported submodel rig"></canvas>
  <span id="rig-note" role="status"></span><div id="rig-tools"><button id="fit-rig">Fit rig</button><label><input id="parent-links" type="checkbox" checked>Parent links</label></div></div></details>
  <div class="preview-heading"><h2 id="heading">Planned INI</h2><button id="copy" class="primary" disabled>Copy INI</button></div>
  <small id="targetName"></small><pre id="preview" tabindex="0"></pre></section></main>
  <footer><button id="new" disabled>Open as new INI</button><button id="save" disabled>Save INI as…</button>
  <button id="target">Choose target INI…</button><button id="apply" class="primary" hidden>Apply changes</button>
  <button id="clearTarget" hidden>Back to generated INI</button><span id="status" role="status"></span></footer>
  <script nonce="${nonce}" src="${script}"></script></body></html>`;
}
