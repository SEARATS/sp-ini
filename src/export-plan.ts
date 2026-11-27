import { assignPaths, defaultRole, flatten, generate, snippet, type ModelNode, type Role } from "./hierarchy";
import { colliderType, tagOverride, type MeshTags } from "./mesh-names";
import { meshFlagMatcher } from "./mesh-flags";
import { categoryFor, lodLevel, type ExportCategory, type ExportChoice } from "./export-roles";
export { exportCategories, type ExportCategory, type ExportChoice } from "./export-roles";

export interface ExportRow { path: string; name: string; mesh: string; depth: number; category: ExportChoice; tags: string[]; triangles?: number }

export function objExportHierarchy(text: string, tags: MeshTags) {
  const objects: {name:string; triangles:number}[] = [], groups = new Map<string, number>();
  let active: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([og])\s+([^#\r\n]+)/.exec(line);
    const name = match?.[2].trim();
    if (name && match[1] === "o") objects.push({name,triangles:0});
    else if (name) {
      active = [...new Set(name.split(/\s+/))];
      for (const group of active) if (!groups.has(group)) groups.set(group,0);
    } else if (/^\s*f\s/.test(line)) {
      const triangles = Math.max(0,line.split("#",1)[0].trim().split(/\s+/).length - 3);
      if (objects.length) objects.at(-1).triangles += triangles;
      else for (const group of active) groups.set(group,groups.get(group) + triangles);
    }
  }
  return assignPaths((objects.length ? objects : [...groups].map(([name,triangles]) => ({name,triangles}))).map(({name,triangles}, i) => ({
    name, triangles, mesh:name, id:String(i), path:"", position:[0,0,0], children:[], colliderOverride:tagOverride(tags, "Collider", [name])
  })));
}

function categoryOf(node: ModelNode): ExportCategory {
  if (!node.mesh) return "Helper";
  return defaultRole(node) === "Collider" ? "Collider" : "Mesh";
}

export function exportRows(nodes: ModelNode[], tags?: MeshTags, rules?: unknown): ExportRow[] {
  const match = meshFlagMatcher(rules, tags);
  function rows(nodes: ModelNode[], depth: number): ExportRow[] {
    return nodes.flatMap(n => {
      const labels = n.mesh ? match(n.mesh, n.name).map(flag => flag.label) : [];
      const collider = tags ? colliderType(tags, n.mesh, n.name) || labels.includes("Collider") : categoryOf(n) === "Collider";
      if (n.mesh && collider && !labels.includes("Collider") && !(tags && tagOverride(tags,"Collider",[n.mesh,n.name]) === false)) labels.push("Collider");
      const category: ExportChoice = !n.mesh ? "Helper" : labels.includes("Hull collider") ? "Hull collider" : collider ? "Collider" :
        labels.includes("Primary damage mesh") ? "Primary damage mesh" : labels.includes("Primary mesh") ? "Primary mesh" :
        labels.includes("LOD") ? "LOD" : labels.includes("Damaged") ? "Damaged" : "Mesh";
      return [{path:n.path, name:n.name, mesh:n.mesh, triangles:n.triangles, depth, category, tags:labels}, ...rows(n.children, depth + 1)];
    });
  }
  return rows(nodes, 0);
}

/** Export all scene roots, including single-part models. INI section names must be unique. */
export function planExport(model: string, roots: ModelNode[], enabled: ReadonlySet<ExportCategory>,
    overrides: ReadonlyMap<string, ExportChoice>, original?: string, distances: readonly number[] = []) {
  const reserved = new Set(flatten(roots).map(n => n.name.toLowerCase()));
  const used = new Set(["visibleparent", "models", "colliders", "submodels"]), roles: Record<string, Role> = {};
  let count = 0;
  let levels = 0;
  const damage = new Set<string>();
  const modelFields = new Map<string,string>();
  function prepare(node: ModelNode): ModelNode {
    const choice = overrides.get(node.path) ?? categoryOf(node);
    const category = categoryFor(choice);
    const selected = category !== "Skip" && enabled.has(category);
    // Unity resolves the child Transform name; FBX geometry can have a separate datablock name.
    const reference = /\.(fbx|blend)$/i.test(model) ? node.name : node.mesh;
    const variant = category === "LOD" || category === "Damaged";
    const modelKey = choice === "Primary mesh" ? "ResourcesMesh" : choice === "Primary damage mesh" ? "ResourcesDamagedMesh" : choice === "Hull collider" ? "ResourcesMeshHullCollider" : "";
    if (selected && modelKey) {
      if (modelFields.has(modelKey)) throw Error("Choose only one " + choice.toLowerCase() + ".");
      if (/[\r\n\[\];#=]|\/\//.test(reference)) throw Error("Invalid mesh name: " + reference);
      modelFields.set(modelKey,reference);
      if (choice !== "Hull collider") count++;
    } else if (selected && variant) {
      if (category === "LOD") {
        const level = lodLevel(reference,node.mesh);
        if (!Number.isInteger(level) || level < 1 || level > 64) throw Error(node.mesh + ": use a mesh ending in _lod1 through _lod64, or choose another export role.");
        levels = Math.max(levels, level);
        count++;
      } else if (!/_d$/i.test(reference)) {
        if (/[\r\n\[\];#=]|\/\//.test(reference)) throw Error("Invalid damage mesh name: " + reference);
        damage.add(reference);
      }
    }
    const role = !selected || variant || choice === "Primary mesh" ? "Skip" : category === "Collider" ? "Collider" : "Submodel";
    roles[node.path] = role;
    let name = node.name;
    if (role !== "Skip") {
      count++;
      if (used.has(name.toLowerCase())) {
        let i = 2;
        do { name = node.name + "_" + i++; } while (reserved.has(name.toLowerCase()) || used.has(name.toLowerCase()));
      }
      used.add(name.toLowerCase());
    }
    return {...node, name, mesh:category === "Helper" ? "" : reference, children:node.children.map(prepare)};
  }
  const scene: ModelNode = {name:"VisibleParent", mesh:"", path:"/!export-scene", id:"", position:[0,0,0], children:roots.map(prepare)};
  const lod = Array.from({length:levels}, (_, i) => distances[i] ?? (i + 1) * 0.5);
  if (lod.some((v,i) => !Number.isFinite(v) || v <= (lod[i-1] ?? 0))) throw Error("LOD distances must be positive and increase with each level.");
  count += damage.size;
  const variants = {lod, damage:[...damage], fields:modelFields};
  const text = count ? snippet(model, scene, roles, variants) : "";
  const after = original === undefined || !count ? original : generate(original, model, scene, roles, variants);
  const primary = modelFields.get("ResourcesMesh"), wreck = modelFields.get("ResourcesDamagedMesh");
  const note = primary && wreck && wreck.toLowerCase() !== primary.toLowerCase() + "_d" ?
    "Sea Power looks for " + primary + "_d as the primary damage mesh." : "";
  return {count, text, after, note};
}
