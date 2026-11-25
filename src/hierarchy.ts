import type { FBXNode } from "fbx-parser";
import { fbxTree } from "./fbx-geometry";
import { Matrix4, Vector3, Quaternion, Euler, MathUtils } from "three";
import { createHash } from "node:crypto";
import { createTwoFilesPatch } from "diff";
import { parse } from "./ini";
import { isColliderName } from "./mesh-names";

export type Role = "Submodel" | "Collider" | "Skip";
export interface ModelNode {
  id: string; name: string; mesh: string; path: string; position: number[]; transform?: Matrix4; children: ModelNode[];
}
const clean = (value: unknown) => String(value).split("\0")[0].replace(/^(?:Model|Geometry)::/, "");
const children = (row: FBXNode, key: string) => row?.nodes?.filter(n => n.name === key) ?? [];

export function hierarchy(bytes: Buffer): ModelNode[] {
  const tree = fbxTree(bytes);
  const axes = tree.find(n=>n.name==="GlobalSettings")?.nodes.find(n=>n.name==="Properties70")?.nodes;
  const setting = (key:string,fallback:number) => Number(axes?.find(p=>p.props[0]===key)?.props[4] ?? fallback);
  const basis = new Matrix4().set(0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,1);
  for (const [row,[axis,sign]] of [[setting("CoordAxis",0),-setting("CoordAxisSign",1)],
      [setting("UpAxis",1),setting("UpAxisSign",1)],[setting("FrontAxis",2),setting("FrontAxisSign",1)]].entries())
    basis.elements[4*axis+row] = sign;
  if (Math.abs(basis.determinant())!==1) throw Error("Invalid FBX coordinate axes");
  const objects = tree.find(n=>n.name==="Objects");
  const nodes = new Map<string,ModelNode>(), geometries = new Map<string,string>();
  for (const item of objects?.nodes || []) {
    const [id, label] = item.props, name = clean(label);
    if (item.name === "Geometry") geometries.set(String(id),name);
    if (item.name !== "Model") continue;
    const properties = children(item,"Properties70")[0] || children(item,"Properties60")[0];
    const vector = (key:string, fallback:number[]) => properties?.nodes.find(n=>n.props[0]===key)?.props.slice(-3).map(Number) || fallback;
    const position = new Vector3().fromArray(vector("Lcl Translation",[0,0,0]));
    const angles = vector("Lcl Rotation",[0,0,0]).map(MathUtils.degToRad);
    const rotation = new Quaternion().setFromEuler(new Euler(angles[0],angles[1],angles[2],"ZYX"));
    const transform = new Matrix4().compose(position,rotation,new Vector3().fromArray(vector("Lcl Scaling",[1,1,1])));
    transform.premultiply(basis).multiply(basis.clone().invert());
    nodes.set(String(id),{id:String(id),name,mesh:"",path:"",children:[],transform,position:new Vector3().setFromMatrixPosition(transform).toArray()});
  }
  const attached = new Set<string>();
  for (const link of children(tree.find(n=>n.name==="Connections"),"C")) {
    const [kind, from, to] = link.props.map(String);
    const parent = nodes.get(to);
    if (kind !== "OO" || !parent) continue;
    if (geometries.has(from)) parent.mesh ||= geometries.get(from) || parent.name;
    const child = nodes.get(from);
    if (child && !attached.has(from)) { parent.children.push(child); attached.add(from); }
  }
  const roots = [...nodes.values()].filter(n=>!attached.has(n.id));
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
export function defaultRole(n: ModelNode): Role { return isColliderName(n.mesh || n.name) ? "Collider" : "Submodel"; }

export function generate(original: string, model: string, root: ModelNode, roles: Record<string,Role> = {}) {
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
      "Parent="+parent, "Position="+new Vector3().setFromMatrixPosition(local).toArray().map(v=>Number(v.toFixed(7))).join(","));
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
export function snippet(model: string, root: ModelNode, roles: Record<string,Role> = {}) {
  return generate("",model,root,roles).split("\n").filter(line=>!/^; sp-ini [0-9a-f]+ (begin|end)$/.test(line)).join("\n").trim()+"\n";
}
export const changes = (target: string, before: string, after: string) => createTwoFilesPatch(target,target,before,after);
