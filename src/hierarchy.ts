import { readFbx, type FbxScene } from "./fbx-reader";
import { fbxBasis } from "./fbx-scene";
import { Matrix4, Vector3 } from "three";
import { createHash } from "node:crypto";
import { createTwoFilesPatch } from "diff";
import { parse } from "./ini";
import { colliderType, isColliderName, type MeshTags } from "./mesh-names";

export type Role = "Submodel" | "Collider" | "Skip";
export interface ModelNode {
  id: string; name: string; mesh: string; path: string; position: number[]; transform?: Matrix4; children: ModelNode[];
  colliderOverride?: boolean;
  triangles?: number;
}
export function hierarchy(bytes: Buffer, tags?: MeshTags): ModelNode[] {
  const roots = sceneHierarchy(readFbx(bytes, "hierarchy"));
  if (tags?.size) for (const node of flatten(roots)) {
    if (node.mesh) node.colliderOverride = colliderType(tags, node.mesh, node.name);
  }
  return roots;
}

export function sceneHierarchy(scene: FbxScene) {
  const basis = new Matrix4().makeScale(-1,1,1).multiply(fbxBasis(scene.axes)), inverse = basis.clone().invert();
  const nodes = new Map<number, ModelNode>();
  for (const source of scene.nodes) {
    const transform = new Matrix4().fromArray(source.local).premultiply(basis).multiply(inverse);
    nodes.set(source.index, {id: source.id, name: source.name, mesh: source.mesh < 0 ? "" : scene.meshes[source.mesh].name || source.name,
      path: "", children: [], triangles:scene.meshes[source.mesh]?.triangles, transform, position: new Vector3().setFromMatrixPosition(transform).toArray()});
  }
  const roots: ModelNode[] = [];
  for (const source of scene.nodes) (nodes.get(source.parent)?.children ?? roots).push(nodes.get(source.index));
  return assignPaths(roots);
}

export function assignPaths(roots: ModelNode[]) {
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
interface ModelVariants { lod: number[]; damage: string[]; fields: Map<string,string> }

export function colliderSnippet(model: string, roots: ModelNode[], selected: ReadonlySet<string>) {
  const roles: Record<string, ExportRole> = {};
  for (const node of flatten(roots)) roles[node.path] = selected.has(node.path) ? "Collider" : "Existing parent";
  const scene: ModelNode = { id: "", name: "VisibleParent", mesh: "", path: "", position: [0,0,0], children: roots };
  return snippet(model, scene, roles);
}

export function generate(original: string, model: string, root: ModelNode, roles: Record<string,ExportRole> = {}, variants?: ModelVariants) {
  const id = createHash("sha256").update(model + "\n" + root.path).digest("hex").slice(0,16);
  const begin = "; sp-ini " + id + " begin", end = "; sp-ini " + id + " end";
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const lines: string[] = [];
  const previousLists = new Set<string>();
  let owned = false;
  for (const line of original.split(/\r\n|\n/)) {
    if (line === begin) { if (owned) throw Error("Nested generator markers"); owned = true; }
    else if (line === end) { if (!owned) throw Error("Unmatched generator marker"); owned = false; }
    else if (!owned) lines.push(line);
    else {
      const key = /^\s*(SubModel|MeshCollider|DamageModel)\d+\s*=/i.exec(line);
      if (key) previousLists.add(key[1].toLowerCase());
    }
  }
  if (owned) throw Error("Unclosed generator marker");
  const existing = parse(lines.join("\n"));
  if (variants && (variants.fields.size || variants.lod.length || variants.damage.length || previousLists.has("damagemodel"))) {
    const models = existing.sections.find(section => section.name.toLowerCase() === "models");
    const keys = new Map(models?.keys.map(entry => [entry.name.toLowerCase(), entry]));
    const fields: string[] = [];
    const set = (name: string, value: number | string) => {
      const key = keys.get(name.toLowerCase());
      if (key) lines[key.line] = lines[key.line].slice(0,key.valueStart) + value + lines[key.line].slice(key.valueStart + key.value.length);
      else fields.push(name + "=" + value);
    };
    for (const [key,value] of variants.fields) set(key,value);
    if (variants.lod.length) {
      set("LODLevels", Math.max(Number(keys.get("lodlevels")?.value) || 0, variants.lod.length));
      variants.lod.forEach((distance,i) => set("LOD" + (i + 1) + "Distance", distance));
    }
    const existingDamage = [...keys.values()].filter(k => /^DamageModel\d+$/i.test(k.name));
    const assigned = new Set(existingDamage.map(k => k.value.toLowerCase()));
    let index = Math.max(0,...existingDamage.map(k => Number(k.name.slice(11))));
    for (const name of variants.damage) if (!assigned.has(name.toLowerCase())) {
      fields.push("DamageModel" + (++index) + "=" + name);
      assigned.add(name.toLowerCase());
    }
    if (variants.damage.length || previousLists.has("damagemodel")) {
      if (index || keys.has("numberofdamagemodels")) set("NumberOfDamageModels", index);
    }
    if (fields.length) {
      if (models) lines.splice(models.line + 1,0,begin,...fields,end);
      else lines.push(begin,"[Models]",...fields,end);
    }
  }
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
      "Parent="+(name.toLowerCase()===parent.toLowerCase() && parent===root.name ? "VisibleParent" : parent));
    const position = new Vector3().setFromMatrixPosition(local).toArray().map(v => Number(v.toFixed(7)));
    if (position.some(v => v !== 0)) sections.push("Position=" + position.join(","));
    n.children.forEach(c=>visit(c,name,new Matrix4()));
  }
  root.children.forEach(n=>visit(n,root.name,new Matrix4()));
  for (const role of ["Submodel","Collider"] as const) {
    const title = role === "Collider" ? "Colliders" : "Submodels";
    const prefix = role === "Collider" ? "MeshCollider" : "SubModel";
    if (!groups[role].length && !previousLists.has(prefix.toLowerCase())) continue;
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
export function snippet(model: string, root: ModelNode, roles: Record<string,ExportRole> = {}, variants?: ModelVariants) {
  return generate("",model,root,roles,variants).split("\n").filter(line=>!/^; sp-ini [0-9a-f]+ (begin|end)$/.test(line)).join("\n").trim()+"\n";
}
export const changes = (target: string, before: string, after: string) => createTwoFilesPatch(target,target,before,after);
