import { constants, copyFileSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { isSeq, parseDocument } from "yaml";
import type { MeshTags } from "./mesh-names";
import { primitiveTags, specialRoles } from "./export-roles";

export const meshSidecar = (model: string) => model.replace(/\.(?:obj|fbx|blend)$/i, ".meshes.yaml");

function read(file: string): string | undefined {
  try { return readFileSync(file, "utf8"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}

function decode(source: string, file: string) {
  const doc = parseDocument(source);
  const tags: MeshTags = new Map();
  try {
    if (doc.errors.length) throw doc.errors[0];
    const root = doc.toJS({mapAsMap:true, maxAliasCount:0});
    if (root == null) return {doc, tags};
    if (!(root instanceof Map)) throw Error("Expected a YAML mapping.");
    const meshes = root.get("meshes");
    if (meshes === undefined) return {doc, tags};
    if (!(meshes instanceof Map)) throw Error("meshes must be a mapping of names to overrides.");
    for (const [name, entry] of meshes) {
      if (typeof name !== "string" || !(entry instanceof Map)) throw Error("Each mesh needs a name and a mapping.");
      const flags = new Map<string, boolean>();
      const type = entry.get("type");
      if (type !== undefined) {
        if (type !== "mesh" && type !== "collider") throw Error(name + ".type must be mesh or collider.");
        flags.set("Collider", type === "collider");
      }
      for (const key of ["add", "disable"]) {
        if (!entry.has(key)) continue;
        const labels = entry.get(key);
        if (!Array.isArray(labels) || !labels.every(s => typeof s === "string" && s.trim())) throw Error(name + "." + key + " must be a list of tag names.");
        for (const label of labels) flags.set(label, key === "add");
      }
      tags.set(name, flags);
    }
    return {doc, tags};
  } catch (error) { throw Error(basename(file) + ": " + error.message); }
}

export function readMeshTags(model: string): MeshTags {
  return readMeshOverrides(model).tags;
}

export function readMeshOverrides(model: string) {
  const file = meshSidecar(model);
  const source = file === model ? undefined : read(file);
  if (!source) return {tags:new Map() as MeshTags,order:[] as string[]};
  const {doc,tags} = decode(source,file);
  return {tags,order:meshOrder(doc)};
}

function meshOrder(doc: ReturnType<typeof parseDocument>): string[] {
  const seq = doc.get("order",true);
  if (seq === undefined) return [];
  const names = isSeq(seq) && seq.toJSON();
  if (!names || !names.every(s => typeof s === "string") || new Set(names).size !== names.length) throw Error("Mesh order must be a list of unique object names.");
  return names;
}

export function moveMesh(model:string, siblings:string[], key:string, direction:number) {
  if (!Array.isArray(siblings) || !siblings.every(s => typeof s === "string") || !siblings.includes(key) || ![-1,1].includes(direction)) return;
  const file = meshSidecar(model);
  if (file === model) throw Error("Choose an OBJ, FBX or Blend model.");
  const before = read(file);
  const {doc} = decode(before ?? "",file);
  const order = meshOrder(doc), scope = new Set(siblings);
  const current = [...order.filter(s => scope.has(s)), ...siblings.filter(s => !order.includes(s))];
  const i = current.indexOf(key), j = i + direction;
  if (j < 0 || j >= current.length) return;
  [current[i],current[j]] = [current[j],current[i]];
  let slot = 0;
  doc.set("order",[...order.map(s => scope.has(s) ? current[slot++] : s),...current.slice(slot)]);
  save(file,before,doc);
}

/** Re-read on acceptance so concurrent pickers only change their edited tags. */
export function writeMeshTags(model: string, name: string, changes: Map<string, boolean>, objectName = name) {
  if (!changes.size) return;
  const file = meshSidecar(model);
  if (file === model) throw Error("Expected an OBJ, FBX or Blend model.");
  const before = read(file);
  const {doc} = decode(before ?? "", file);
  const groups = new Map<string,Map<string,boolean>>();
  for (const [label,value] of changes) {
    const key = specialRoles.some(role => role === label) || Object.hasOwn(primitiveTags,label) ? objectName : name;
    if (!groups.has(key)) groups.set(key,new Map());
    groups.get(key).set(label,value);
  }
  for (const [key,flags] of groups) applyTags(doc,["meshes",key],flags);
  save(file,before,doc);
}

function applyTags(doc:ReturnType<typeof parseDocument>, path:string[], changes:Map<string,boolean>) {
  for (const key of ["add", "disable"] as const) {
    const sequence = doc.getIn([...path, key], true);
    const current = isSeq(sequence) ? sequence.toJSON() as string[] : [];
    const next = current.filter(label => !changes.has(label));
    for (const [label, enabled] of changes) if (label !== "Collider" && enabled === (key === "add")) next.push(label);
    if (next.length) doc.setIn([...path, key], next);
    else if (current.length) doc.deleteIn([...path, key]);
  }
  if (changes.has("Collider")) doc.setIn([...path, "type"], changes.get("Collider") ? "collider" : "mesh");
}

function save(file:string, before:string | undefined, doc:ReturnType<typeof parseDocument>) {
  const temp = file + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(temp, doc.toString(), {flag:"wx"});
    if (before !== read(file)) throw Error(basename(file) + " changed during the edit. Try again.");
    if (before === undefined) copyFileSync(temp, file, constants.COPYFILE_EXCL);
    else renameSync(temp, file);
  } finally { rmSync(temp, {force:true}); }
}
