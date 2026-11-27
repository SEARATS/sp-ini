import { readFbx, type FbxScene } from "./fbx-reader";
import { fbxBasis } from "./fbx-scene";
import { Matrix4, Vector3 } from "three";
import { createHash } from "node:crypto";
import { createTwoFilesPatch } from "diff";
import { parse } from "./ini";
import { isColliderName, tagOverride, type MeshTags } from "./mesh-names";

export type Role = "Submodel" | "Collider" | "Skip";
export interface ModelNode {
  id: string; name: string; mesh: string; path: string; position: number[]; transform?: Matrix4; children: ModelNode[];
  colliderOverride?: boolean;
}
export function hierarchy(bytes: Buffer, tags?: MeshTags): ModelNode[] {
  const roots = sceneHierarchy(readFbx(bytes, "hierarchy"));
  if (tags?.size) for (const node of flatten(roots)) {
    if (node.mesh) node.colliderOverride = tagOverride(tags, "Collider", [node.mesh, node.name]);
  }
  return roots;
}

export function sceneHierarchy(scene: FbxScene) {
  const basis = new Matrix4().makeScale(-1,1,1).multiply(fbxBasis(scene.axes)), inverse = basis.clone().invert();
  const nodes = new Map<number, ModelNode>();
  for (const source of scene.nodes) {
    const transform = new Matrix4().fromArray(source.local).premultiply(basis).multiply(inverse);
    nodes.set(source.index, {id: source.id, name: source.name, mesh: source.mesh < 0 ? "" : scene.meshes[source.mesh].name || source.name,
      path: "", children: [], transform, position: new Vector3().setFromMatrixPosition(transform).toArray()});
  }
  const roots: ModelNode[] = [];
  for (const source of scene.nodes) (nodes.get(source.parent)?.children ?? roots).push(nodes.get(source.index));
  return assignPaths(roots);
}

function assignPaths(roots: ModelNode[]) {
  function paths(siblings: ModelNode[], base: string) {
    const counts = new Map<string,number>();
    for (const n of siblings) {
      const index = (counts.get(n.name)||0)+1;
      counts.set(n.name,index);
      n.path = base + "/" + encodeURIComponent(n.name) + (index>1 ? "["+index+"]" : "");
      paths(n.children,n.path);
    }
  }
  paths(roots,"");
  return roots;
}
export function flatten(nodes: ModelNode[]): ModelNode[] { return nodes.flatMap(n=>[n,...flatten(n.children)]); }
export function selectParent(roots: ModelNode[], parent: string) {
  const matches = flatten(roots).filter(n=>n.path===parent || n.name===parent);
  if (matches.length!==1) throw Error("Choose a unique parent path for " + parent);
  return matches[0];
}
export function defaultRole(n: ModelNode): Role { return (n.colliderOverride ?? (isColliderName(n.name) || isColliderName(n.mesh))) ? "Collider" : "Submodel"; }

type ExportRole = Role | "Existing parent";

export function colliderSnippet(model: string, roots: ModelNode[], selected: ReadonlySet<string>) {
  const roles: Record<string, ExportRole> = {};
  for (const node of flatten(roots)) roles[node.path] = selected.has(node.path) ? "Collider" : "Existing parent";
  const scene: ModelNode = { id: "", name: "VisibleParent", mesh: "", path: "", position: [0,0,0], children: roots };
  return snippet(model, scene, roles);
}

export function generate(original: string, model: string, root: ModelNode, roles: Record<string,ExportRole> = {}) {
  const id = createHash("sha256").update(model + "\n" + root.path).digest("hex").slice(0,16);
  const begin = "; sp-ini " + id + " begin", end = "; sp-ini " + id + " end";
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const lines: string[] = [];
  let owned = false;
  for (const line of original.split(/\r\n|\n/)) {
    if (line === begin) { if (owned) throw Error("Nested generator markers"); owned = true; }
    else if (line === end) { if (!owned) throw Error("Unmatched generator marker"); owned = false; }
    else if (!owned) lines.push(line);
  }
  if (owned) throw Error("Unclosed generator marker");
  const existing = parse(lines.join("\n"));
  const names = new Set(existing.sections.map(s=>s.name.toLowerCase()));
  const groups = {Submodel:[] as string[],Collider:[] as string[]};
  const sections: string[] = [];
  function visit(n: ModelNode,parent: string, inherited: Matrix4) {
    if (roles[n.path] === "Existing parent") {
      n.children.forEach(child => visit(child, n.name, new Matrix4()));
      return;
    }
    const local = inherited.clone().multiply(n.transform || new Matrix4().makeTranslation(n.position[0],n.position[1],n.position[2]));
    const role = roles[n.path] ?? defaultRole(n);
    if (role === "Skip") {
      n.children.forEach(c=>visit(c,parent,local));
      return;
    }
    if (!(role in groups)) throw Error("Unknown role for " + n.path);
    const name = n.name, mesh = n.mesh || (role === "Collider" ? name : "Dummy");
    if ([name,mesh,parent].some(s=>/[\r\n\[\];#=]|\/\//.test(s))) throw Error("Invalid INI name in " + n.path);
    if (names.has(name.toLowerCase())) throw Error("Section ["+name+"] already exists. Skip the object or rename it.");
    names.add(name.toLowerCase());
    groups[role].push(name);
    sections.push("", "["+name+"]", (role==="Collider"?"Collider=":"Mesh=")+mesh,
      "Parent="+(name.toLowerCase()===parent.toLowerCase() && parent===root.name ? "VisibleParent" : parent), "Position="+new Vector3().setFromMatrixPosition(local).toArray().map(v=>Number(v.toFixed(7))).join(","));
    n.children.forEach(c=>visit(c,name,new Matrix4()));
  }
  root.children.forEach(n=>visit(n,root.name,new Matrix4()));
  for (const role of ["Submodel","Collider"] as const) {
    const title = role === "Collider" ? "Colliders" : "Submodels";
    const prefix = role === "Collider" ? "MeshCollider" : "SubModel";
    const countKey = role === "Collider" ? "NumberOfMeshColliders" : "NumberOfSubmodels";
    const current = parse(lines.join("\n"));
    const section = current.sections.find(s=>s.name.toLowerCase()===title.toLowerCase());
    const keys = section?.keys || [];
    let index = Math.max(0,...keys.map(k=>Number(new RegExp("^"+prefix+"(\\d+)$","i").exec(k.name)?.[1]) || 0));
    const added = groups[role].map(name=>prefix+(++index)+"="+name);
    const count = keys.find(k=>k.name.toLowerCase() === countKey.toLowerCase());
    if (count) lines[count.line] = lines[count.line].slice(0,count.valueStart)+index+lines[count.line].slice(count.valueStart+count.value.length);
    if (role==="Collider" && !count && added.length) added.unshift(countKey+"="+index);
    if (!added.length) continue;
    if (section) lines.splice(section.line+1,0,begin,...added,end);
    else lines.push(begin,"["+title+"]",...added,end);
  }
  if (sections.length) lines.push(begin,...sections,end);
  return lines.join(eol);
}
export function snippet(model: string, root: ModelNode, roles: Record<string,ExportRole> = {}) {
  return generate("",model,root,roles).split("\n").filter(line=>!/^; sp-ini [0-9a-f]+ (begin|end)$/.test(line)).join("\n").trim()+"\n";
}
export const changes = (target: string, before: string, after: string) => createTwoFilesPatch(target,target,before,after);
