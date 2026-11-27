import * as vscode from "vscode";
import { dirname } from "node:path";
import { colliderType, tagOverride } from "./mesh-names";
import { meshFlagMatcher, meshFlagSetting } from "./mesh-flags";
import { meshSidecar, moveMesh, readMeshTags, writeMeshTags } from "./mesh-sidecar";
import { primitiveTags, specialRoles } from "./export-roles";

export function watchMeshTags(uri: vscode.Uri, refresh: () => void) {
  const file = vscode.Uri.file(meshSidecar(uri.fsPath)).toString();
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(dirname(uri.fsPath)), "*"));
  const changed = (next: vscode.Uri) => { if (next.toString() === file) refresh(); };
  watcher.onDidChange(changed);
  watcher.onDidCreate(changed);
  watcher.onDidDelete(changed);
  return watcher;
}

export async function editMeshTags(uri: vscode.Uri, names: string[], effective?: string[], objectName = names[0], mode: "edit" | "add" = "edit") {
  const tags = readMeshTags(uri.fsPath);
  const match = meshFlagMatcher(vscode.workspace.getConfiguration(undefined, uri).get(meshFlagSetting), tags);
  const current = new Set(effective ?? match(...names).map(flag => flag.label));
  if (colliderType(tags, ...names) && tagOverride(tags,"Collider",names) !== false) current.add("Collider");
  const labels = new Set([...match.labels, ...specialRoles, ...Object.keys(primitiveTags), "Collider", ...current, ...names.flatMap(name => [...(tags.get(name)?.keys() ?? [])])]);
  const adding = mode === "add";
  const choices = [...labels].filter(label => !adding || !current.has(label)).map(label => ({label, picked:current.has(label), custom:false}));
  choices.push({label:"$(add) Add custom tag…", picked:false, custom:true});
  const selection = await vscode.window.showQuickPick(choices, {title:(adding ? "Add tags · " : "Mesh tags · ") + objectName, canPickMany:true,
    placeHolder:adding ? "Select tags to add" : "Check tags to enable them, or uncheck to disable them"});
  if (!selection) return;
  const next = new Set(adding ? current : []);
  for (const item of selection) if (!item.custom) next.add(item.label);
  if (selection.some(item => item.custom)) {
    const custom = await vscode.window.showInputBox({title:"New mesh tag", prompt:"Tag name", validateInput:s => s.trim() ? undefined : "Enter a name."});
    if (!custom?.trim()) return;
    next.add(custom.trim());
  }
  const changes = new Map<string, boolean>();
  for (const label of new Set([...next, ...current])) if (next.has(label) !== current.has(label)) changes.set(label, next.has(label));
  saveMeshTagChanges(uri,names[0],objectName,changes);
}

export function saveMeshTagChanges(uri:vscode.Uri, mesh:string, objectName:string, changes:Map<string,boolean>) {
  if (!changes.size) return;
  checkSidecar(uri);
  writeMeshTags(uri.fsPath, mesh, changes, objectName);
}

function checkSidecar(uri:vscode.Uri) {
  const sidecar = vscode.Uri.file(meshSidecar(uri.fsPath)).toString();
  if (vscode.workspace.textDocuments.some(doc => doc.uri.toString() === sidecar && doc.isDirty)) throw Error("Save your open mesh sidecar first.");
}

export function moveMeshInList(uri:vscode.Uri, message:{siblings:string[]; key:string; direction:number}) {
  checkSidecar(uri);
  moveMesh(uri.fsPath,message.siblings,message.key,message.direction);
}
