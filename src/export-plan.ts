import { assignPaths, defaultRole, flatten, generate, snippet, type ModelNode, type Role } from "./hierarchy";
import { tagOverride, type MeshTags } from "./mesh-names";

export const exportCategories = ["Mesh", "Collider", "Helper"] as const;
export type ExportCategory = typeof exportCategories[number];
export type ExportChoice = ExportCategory | "Skip";
export interface ExportRow { path: string; name: string; mesh: string; depth: number; category: ExportCategory }

export function objExportHierarchy(text: string, tags: MeshTags) {
  const names: string[] = [], groups = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([og])\s+([^#\r\n]+)/.exec(line);
    const name = match?.[2].trim();
    if (!name) continue;
    if (match[1] === "o") names.push(name);
    else name.split(/\s+/).forEach(group => groups.add(group));
  }
  return assignPaths((names.length ? names : [...groups]).map((name, i) => ({
    name, mesh:name, id:String(i), path:"", position:[0,0,0], children:[], colliderOverride:tagOverride(tags, "Collider", [name])
  })));
}

function categoryOf(node: ModelNode): ExportCategory {
  if (!node.mesh) return "Helper";
  return defaultRole(node) === "Collider" ? "Collider" : "Mesh";
}

export function exportRows(nodes: ModelNode[], depth = 0): ExportRow[] {
  return nodes.flatMap(n => [{path:n.path, name:n.name, mesh:n.mesh, depth,
    category:categoryOf(n)}, ...exportRows(n.children, depth + 1)]);
}

/** Export all scene roots, including single-part models. INI section names must be unique. */
export function planExport(model: string, roots: ModelNode[], enabled: ReadonlySet<ExportCategory>,
    overrides: ReadonlyMap<string, ExportChoice>, original?: string) {
  const reserved = new Set(flatten(roots).map(n => n.name.toLowerCase()));
  const used = new Set(["visibleparent", "models", "colliders", "submodels"]), roles: Record<string, Role> = {};
  let count = 0;
  function prepare(node: ModelNode): ModelNode {
    const category = overrides.get(node.path) ?? categoryOf(node);
    const role = category === "Skip" || !enabled.has(category) ? "Skip" : category === "Collider" ? "Collider" : "Submodel";
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
    return {...node, name, mesh:category === "Helper" ? "" : node.mesh, children:node.children.map(prepare)};
  }
  const scene: ModelNode = {name:"VisibleParent", mesh:"", path:"/!export-scene", id:"", position:[0,0,0], children:roots.map(prepare)};
  const text = count ? snippet(model, scene, roles) : "";
  const after = original === undefined || !count ? original : generate(original, model, scene, roles);
  return {count, text, after};
}
