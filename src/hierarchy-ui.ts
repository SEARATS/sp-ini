import * as vscode from "vscode";
import { basename, dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ModelNode, Role, changes, defaultRole, flatten, generate, hierarchy, snippet } from "./hierarchy";
import { parse } from "./ini";

export function registerHierarchy(context: vscode.ExtensionContext) {
  const changed = new vscode.EventEmitter<void>();
  let file: vscode.Uri, loading: Promise<ModelNode[]> = Promise.resolve([]);
  const select = (uri: vscode.Uri) => {
    if (!uri || !/\.fbx$/i.test(uri.path) || file?.toString()===uri.toString()) return;
    file = uri;
    loading = readFile(uri.fsPath).then(hierarchy);
    loading.catch(() => {});
    changed.fire();
  };
  function active() {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText) select(input.uri);
  }
  const tree = vscode.window.createTreeView("seapower-ini.hierarchy", { treeDataProvider: {
    onDidChangeTreeData: changed.event,
    getChildren: (node?: ModelNode) => node ? node.children : loading,
    getTreeItem: (node: ModelNode) => {
      const item = new vscode.TreeItem(node.name, node.children.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
      item.id = node.path;
      item.contextValue = "spIniParent";
      item.tooltip = node.path;
      return item;
    }
  }});
  const previews = new Map<string,string>();
  const preview = vscode.workspace.registerTextDocumentContentProvider("sp-ini-patch",{
    provideTextDocumentContent: uri => previews.get(uri.toString()) || ""
  });
  const pickFile = async (label: string,ext: string) => (await vscode.window.showOpenDialog({
    openLabel:label,canSelectMany:false,filters:{[ext.toUpperCase()]:[ext]}
  }))?.[0];
  async function referenced(document: vscode.TextDocument,line: number) {
    const ini = parse(document.getText()), entry = ini.entries.find(e=>e.line===line);
    const root = entry && /\.fbx$/i.test(entry.value) ? entry :
      ini.sections.find(s=>/^models$/i.test(s.name))?.keys.find(k=>/^resourcesroot$/i.test(k.name));
    if (!root) return;
    const at = new vscode.Position(root.line,root.valueStart+1);
    const results = await vscode.commands.executeCommand<(vscode.Location|vscode.LocationLink)[]>("vscode.executeDefinitionProvider",document.uri,at);
    for (const result of results || []) {
      const uri = "uri" in result ? result.uri : result.targetUri;
      if (/\.fbx$/i.test(uri.path)) return uri;
    }
    const candidate = vscode.Uri.file(resolve(dirname(document.uri.fsPath),root.value));
    if (/\.fbx$/i.test(candidate.path) && await vscode.workspace.fs.stat(candidate).then(()=>true,()=>false)) return candidate;
  }
  async function run(from: string,node?: ModelNode) {
    const editor = vscode.window.activeTextEditor;
    const existing = from==="ini" ? editor?.document : undefined;
    const model = (node ? file : existing ? await referenced(existing,editor.selection.active.line) : undefined)
      || await pickFile("Choose model","fbx");
    if (!model) return;
    const nodes = flatten(hierarchy(await readFile(model.fsPath)));
    const root = node ? nodes.find(n=>n.path===node.path) : (await vscode.window.showQuickPick(
      nodes.filter(n=>n.children.length).map(n=>({label:n.name,description:n.path,node:n})),{title:"Choose the parent to export",matchOnDescription:true}
    ))?.node;
    if (!root) return;
    const destination = await vscode.window.showQuickPick([existing ? "Current INI" : "INI file","Clipboard"],{title:"Send generated INI to"});
    if (!destination) return;
    const clipboard = destination === "Clipboard";
    const target = clipboard ? undefined : existing?.uri || await pickFile("Choose target INI","ini");
    if (!clipboard && !target) return;
    const doc = target && (existing || await vscode.workspace.openTextDocument(target));
    const children = flatten(root.children), roles: Record<string,Role> = {};
    const title = root.path+" → "+(clipboard ? "Clipboard" : basename(target.fsPath));
    while (true) {
      const items = children.map(n=>({label:n.name,description:roles[n.path] || defaultRole(n),detail:n.path,node:n}));
      const choice = await vscode.window.showQuickPick([{label:clipboard ? "$(preview) Preview INI" : "$(diff) Preview Changes",description:"",detail:target?.fsPath || "Clipboard",node:undefined},...items],
        {title,placeHolder:"Choose an object to change its role, or preview the INI diff",matchOnDetail:true});
      if (!choice) return;
      if (choice.node) {
        const role = await vscode.window.showQuickPick(["Submodel","Collider","Skip"],{title:choice.node.path});
        if (role) roles[choice.node.path] = role as Role;
        continue;
      }
      const before = doc?.getText() || "", version = doc?.version;
      let after: string;
      try { after = clipboard ? snippet(basename(model.fsPath),root,roles) : generate(before,basename(model.fsPath),root,roles); }
      catch (e) { await vscode.window.showWarningMessage(String(e)); continue; }
      if (after===before) { await vscode.window.showInformationMessage("The target INI is up to date."); return; }
      const uri = vscode.Uri.from({scheme:"sp-ini-patch",path:clipboard ? "/Generated.ini" : "/"+basename(target.path)+".diff",query:randomUUID()});
      previews.set(uri.toString(),clipboard ? after : changes(basename(target.path),before,after));
      const patch = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(patch,{preview:true});
      const action = await vscode.window.showQuickPick([clipboard ? "Copy to Clipboard" : "Apply","Edit object roles"],{title});
      if (!action) return;
      if (action==="Copy to Clipboard") {
        await vscode.env.clipboard.writeText(after);
        await vscode.window.showInformationMessage("Copied the generated INI to the clipboard.");
        return;
      }
      if (action!=="Apply") continue;
      if (doc.version!==version) throw Error("The target INI changed. Generate again to review its current diff.");
      const edit = new vscode.WorkspaceEdit();
      edit.replace(target,new vscode.Range(doc.positionAt(0),doc.positionAt(before.length)),after);
      if (!await vscode.workspace.applyEdit(edit)) throw Error("Could not edit the target INI.");
      await vscode.window.showTextDocument(doc);
      return;
    }
  }
  const command = (name:string,from:string) => vscode.commands.registerCommand("seapower-ini."+name,(node?:ModelNode)=>
    run(from,from==="model" ? node : undefined).catch(e=>vscode.window.showErrorMessage(String(e))));
  context.subscriptions.push(changed,tree,preview,command("generate","palette"),command("generateFromModel","model"),
    command("generateFromIni","ini"),vscode.window.tabGroups.onDidChangeTabs(active),
    vscode.workspace.onDidCloseTextDocument(d=>previews.delete(d.uri.toString())));
  active();
}
