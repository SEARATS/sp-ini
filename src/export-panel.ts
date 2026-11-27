import * as vscode from "vscode";
import { basename } from "node:path";
import { randomBytes } from "node:crypto";
import { readBlendPreview } from "./blend-export";
import { changes, hierarchy } from "./hierarchy";
import { exportCategories, exportRows, objExportHierarchy, planExport, type ExportCategory, type ExportChoice } from "./export-plan";
import { readMeshTags } from "./mesh-sidecar";

export async function openExportPanel(context: vscode.ExtensionContext, uri: vscode.Uri) {
  if (uri.scheme !== "file" || !/\.(fbx|obj|blend)$/i.test(uri.path)) throw Error("Choose an OBJ, FBX or Blender file.");
  const name = basename(uri.fsPath);
  const roots = await vscode.window.withProgress({location:vscode.ProgressLocation.Notification, title:"Reading " + name, cancellable:true}, async (_, token) => {
    const controller = new AbortController();
    const cancellation = token.onCancellationRequested(() => controller.abort());
    try {
      const dirty = vscode.workspace.textDocuments.find(doc => doc.isDirty && doc.uri.toString() === uri.toString());
      const bytes = /\.blend$/i.test(name)
        ? await readBlendPreview(uri.fsPath, vscode.workspace.getConfiguration("seapowerIni", uri).get("blenderPath"), controller.signal)
        : dirty ? Buffer.from(dirty.getText()) : Buffer.from(await vscode.workspace.fs.readFile(uri));
      if (token.isCancellationRequested) return;
      const tags = readMeshTags(uri.fsPath);
      return /\.obj$/i.test(name) ? objExportHierarchy(bytes.toString("utf8"), tags) : hierarchy(bytes, tags);
    } catch (error) { if (!token.isCancellationRequested) throw error; }
    finally { cancellation.dispose(); }
  });
  if (!roots) return;
  const rows = exportRows(roots), byPath = new Map(rows.map(row => [row.path, row]));
  const dist = vscode.Uri.joinPath(context.extensionUri, "dist");
  const panel = vscode.window.createWebviewPanel("seapower-ini.export", "Export INI · " + name, vscode.ViewColumn.Active,
    {enableScripts:true, retainContextWhenHidden:true, localResourceRoots:[dist]});
  const web = panel.webview;
  let target: vscode.TextDocument, targetVersion: number, generation = 0, request = 0;
  let plan: ReturnType<typeof planExport>;
  let enabled = new Set<ExportCategory>(exportCategories);
  const roles = new Map<string, ExportChoice>();
  function refresh() {
    generation++;
    plan = undefined;
    const before = target?.getText();
    targetVersion = target?.version;
    let preview = "", error = "";
    try {
      plan = planExport(name, roots, enabled, roles, before);
      if (plan.count) preview = target ? changes(basename(target.fileName), before, plan.after) : plan.text;
    } catch (e) { error = e.message; }
    void web.postMessage({type:"preview", generation, request, preview, error, target:target?.fileName,
      count:plan?.count ?? 0, changed:!target || (plan && before !== plan.after)});
  }
  const edits = vscode.workspace.onDidChangeTextDocument(e => { if (e.document === target) refresh(); });
  panel.onDidDispose(() => edits.dispose());
  web.onDidReceiveMessage(async message => {
    try {
      if (message.type === "ready") {
        await web.postMessage({type:"model", rows, categories:exportCategories});
        refresh();
      } else if (message.type === "selection") {
        if (!Array.isArray(message.categories) || !Array.isArray(message.roles)) return;
        enabled = new Set(exportCategories.filter(c => message.categories.includes(c)));
        roles.clear();
        for (const [path, role] of message.roles) {
          const row = byPath.get(path);
          if (row && (role === "Skip" || role === "Helper" || (row.mesh && (role === "Mesh" || role === "Collider")))) roles.set(path, role);
        }
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
  main{display:grid;grid-template-columns:minmax(260px,1fr) minmax(300px,1.35fr);gap:16px;min-height:0}
  section{min-width:0;min-height:0;display:flex;flex-direction:column} #objects,pre{overflow:auto;border:1px solid var(--vscode-panel-border);margin:0;flex:1}
  .row{display:flex;align-items:center;gap:8px;padding:4px 8px}.row:nth-child(even){background:var(--vscode-list-hoverBackground)}
  .row span{flex:1;overflow-wrap:anywhere}.off span{color:var(--vscode-descriptionForeground)}
  input,select{accent-color:var(--vscode-focusBorder)} select{color:var(--vscode-dropdown-foreground);background:var(--vscode-dropdown-background)}
  pre{padding:12px;font-family:var(--vscode-editor-font-family);user-select:text} #status{color:var(--vscode-descriptionForeground)}
  button{border:0;padding:6px 10px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);cursor:pointer}
  button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}button:disabled{opacity:.5;cursor:default}
  #targetName{overflow-wrap:anywhere} @media(max-width:620px){main{grid-template-columns:1fr;grid-template-rows:1fr 1fr}}
  </style></head><body><header><strong>Export categories</strong><div class="categories"></div></header>
  <main><section><h2>Objects</h2><div id="objects"></div></section><section><h2 id="heading">Planned INI</h2><small id="targetName"></small><pre id="preview" tabindex="0"></pre></section></main>
  <footer><button id="copy" class="primary" disabled>Copy INI</button><button id="new" disabled>Open as new INI</button>
  <button id="target">Choose target INI…</button><button id="apply" class="primary" hidden>Apply changes</button>
  <button id="clearTarget" hidden>Back to generated INI</button><span id="status" role="status"></span></footer>
  <script nonce="${nonce}" src="${script}"></script></body></html>`;
}
