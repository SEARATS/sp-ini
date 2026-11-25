import type { ModelNode } from "./hierarchy";

export interface OutlineNode {
  name: string;
  children: OutlineNode[];
  modelId?: string;
}

export function fbxOutline(nodes: ModelNode[]): OutlineNode[] {
  return nodes.map(node => ({ name: node.name, modelId: node.id, children: fbxOutline(node.children) }));
}

export function objOutline(source: string): OutlineNode[] {
  const objects: OutlineNode[] = [];
  let object: OutlineNode, groups: string[] = [];
  let needsGroups = true;
  const seen = new Set<string>();
  function startObject(name: string) {
    object = { name, children: [] };
    objects.push(object);
    seen.clear();
  }
  for (const line of source.split(/\r?\n/)) {
    const match = /^\s*([ogflp])(?:\s+|$)/.exec(line);
    if (!match) continue;
    const [, kind] = match;
    if (kind === "o" || kind === "g") {
      const name = line.slice(match[0].length).split("#", 1)[0].trim();
      if (kind === "o") {
        startObject(name || "(unnamed object)");
        needsGroups = true;
        continue;
      }
      groups = name ? name.split(/\s+/) : [];
    } else if (!needsGroups) continue;
    needsGroups = false;
    if (!object) startObject("(unnamed object)");
    for (const group of groups) {
      if (seen.has(group)) continue;
      seen.add(group);
      object.children.push({ name: group, children: [] });
    }
  }
  return objects;
}
