import * as vscode from "vscode";
import { basename, dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ModelNode, Role, changes, colliderSnippet, defaultRole, flatten, generate, hierarchy, sceneHierarchy, snippet } from "./hierarchy";
import { readFbx } from "./fbx-reader";
import { modelTags } from "./model-tags";
import { parse } from "./ini";
import { meshFlagMatcher, meshFlagSetting } from "./mesh-flags";
import { watchMeshTags } from "./mesh-tags-ui";
import { readMeshOverrides } from "./mesh-sidecar";
import { orderedSiblings, orderHierarchy } from "./mesh-order";
import { openExportPanel } from "./export-panel";

export function registerHierarchy(context: vscode.ExtensionContext) {
  const changed = new vscode.EventEmitter<void>();
  let file: vscode.Uri, loading: Promise<ModelNode[]> = Promise.resolve([]);
  let watcher: vscode.Disposable;
  let order:string[] = [], activeRoots:ModelNode[] = [];
  const readFlags = () => {
    const rules = vscode.workspace.getConfiguration(undefined, file).get(meshFlagSetting);
    try {
      const saved = file && readMeshOverrides(file.fsPath);
      order = saved?.order ?? [];
      return meshFlagMatcher(rules,saved && modelTags(activeRoots,file.fsPath,saved.tags,rules));
    }
    catch { return meshFlagMatcher(rules); } // The model preview displays the sidecar error.
  };
  let matchFlags = readFlags();
  const select = (uri: vscode.Uri) => {
    if (!uri || !/\.fbx$/i.test(uri.path) || file?.toString()===uri.toString()) return;
    file = uri;
    activeRoots = [];
    watcher?.dispose();
    watcher = watchMeshTags(uri, () => { matchFlags = readFlags(); changed.fire(); });
    matchFlags = readFlags();
    loading = readFile(uri.fsPath).then(bytes => {
      const roots = sceneHierarchy(readFbx(bytes,"counts"));
      if (file === uri) { activeRoots = roots; matchFlags = readFlags(); }
      return roots;
    });
    loading.catch(() => {});
    changed.fire();
  };
  function active() {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText) select(input.uri);
  }
  const tree = vscode.window.createTreeView("seapower-ini.hierarchy", { treeDataProvider: {
    onDidChangeTreeData: changed.event,
    getChildren: async (node?: ModelNode) => orderedSiblings(node ? node.children : await loading,order).map(row => row.node),
    getTreeItem: (node: ModelNode) => {
      const item = new vscode.TreeItem(node.name, node.children.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
      item.id = node.path;
      const flags = node.mesh ? matchFlags(node.mesh, node.name) : [];
      if (flags.length) {
        item.iconPath = new vscode.ThemeIcon(flags[0].icon);
        item.description = flags.map(flag => flag.label).join(", ");
      }
      item.contextValue = node.children.length ? "spIniParent" : "spIniLeaf";
      item.tooltip = [node.path, item.description].filter(Boolean).join("\n");
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
  async function run(from: string,node?: ModelNode,resource?: vscode.Uri, previewNodeId?: string) {
    const editor = vscode.window.activeTextEditor;
    const existing = from==="ini" ? editor?.document : undefined;
    const model = resource || (node ? file : existing ? await referenced(existing,editor.selection.active.line) : undefined)
      || await pickFile("Choose model","fbx");
    if (!model) return;
    const saved = readMeshOverrides(model.fsPath);
    const roots = orderHierarchy(hierarchy(await readFile(model.fsPath),saved.tags),saved.order);
    const nodes = flatten(roots);
    if (node || previewNodeId !== undefined) {
      node = nodes.find(n => previewNodeId !== undefined ? n.id === previewNodeId : n.path === node.path);
      if (!node) throw Error("That object no longer exists in this FBX.");
    }
    if (from === "colliders") {
      const candidates = (node ? flatten([node]) : nodes).filter(n => n.mesh);
      if (!candidates.length) {
        void vscode.window.showInformationMessage("There are no meshes in this selection.");
        return;
      }
      const selected = await vscode.window.showQuickPick(candidates.map(n => ({
        label: n.name, description: n.mesh === n.name ? undefined : n.mesh, detail: n.path,
        picked: defaultRole(n) === "Collider", node: n
      })), { title: "Copy Colliders as INI", placeHolder: "Select collision meshes (likely colliders are preselected)",
        canPickMany: true, matchOnDescription: true, matchOnDetail: true });
      if (!selected?.length) return;
      const paths = new Set(selected.map(item => item.node.path));
      await vscode.env.clipboard.writeText(colliderSnippet(basename(model.fsPath), roots, paths));
      void vscode.window.showInformationMessage("Copied " + paths.size + (paths.size === 1 ? " collider." : " colliders."));
      return;
    }
    const parents = nodes.filter(n=>n.children.length);
    if (!parents.length) {
      void vscode.window.showInformationMessage("This FBX has no child objects to export.");
      return;
    }
    const root = node ? parents.find(n=>n.path===node.path) : from==="copy" && parents.length===1 ? parents[0] : (await vscode.window.showQuickPick(
      parents.map(n=>({label:n.name,description:n.path,node:n})),{title:"Choose the parent to export",matchOnDescription:true}
    ))?.node;
    if (!root) return;
    if (from==="copy") {
      await vscode.env.clipboard.writeText(snippet(basename(model.fsPath),root));
      void vscode.window.showInformationMessage("Copied the INI hierarchy for " + root.name + ".");
      return;
    }
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
  type CopyTarget = vscode.Uri | ModelNode | {spIniFbxUri?: string; spIniModelId?: string};
  const copy = (name: string, from: string) => vscode.commands.registerCommand("seapower-ini."+name, (target?: CopyTarget) => {
    if (!target) return;
    if ("children" in target) return run(from,target).catch(e=>vscode.window.showErrorMessage(String(e)));
    const uri = "fsPath" in target ? target : target.spIniFbxUri && vscode.Uri.parse(target.spIniFbxUri);
    if (uri?.scheme==="file" && /\.fbx$/i.test(uri.path))
      return run(from,undefined,uri,"spIniModelId" in target ? target.spIniModelId : undefined).catch(e=>vscode.window.showErrorMessage(String(e)));
  });
  const exportData = vscode.commands.registerCommand("seapower-ini.exportIniData", async (target?: vscode.Uri | ModelNode | {spIniExportUri?:string}) => {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const activeUri = tab instanceof vscode.TabInputCustom || tab instanceof vscode.TabInputText ? tab.uri : undefined;
    const uri = target && "fsPath" in target ? target : target && "children" in target ? file :
      target && "spIniExportUri" in target && target.spIniExportUri ? vscode.Uri.parse(target.spIniExportUri) : activeUri;
    const model = uri && /\.(obj|fbx|blend)$/i.test(uri.path) ? uri : (await vscode.window.showOpenDialog({filters:{Models:["obj","fbx","blend"]}}))?.[0];
    if (model) await openExportPanel(context, model).catch(error => vscode.window.showErrorMessage(error.message));
  });
  context.subscriptions.push(exportData,copy("copyHierarchy","copy"),copy("copyColliders","colliders"),changed,tree,preview,command("generate","palette"),command("generateFromModel","model"),
    {dispose:() => watcher?.dispose()},
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration(meshFlagSetting, file)) { matchFlags = readFlags(); changed.fire(); }
    }),
    command("generateFromIni","ini"),vscode.window.tabGroups.onDidChangeTabs(active),
    vscode.workspace.onDidCloseTextDocument(d=>previews.delete(d.uri.toString())));
  active();
}
