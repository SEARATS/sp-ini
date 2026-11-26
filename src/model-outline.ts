import type { ModelNode } from "./hierarchy";
import { isColliderName } from "./mesh-names";
import type { PreviewColor } from "./preview-colors";

export interface PreviewPart { id: string; collider: boolean; widget?: boolean }
export interface OutlineNode {
  name: string;
  children: OutlineNode[];
  parts: PreviewPart[];
  modelId?: string;
  entityId?: string;
  tree?: boolean;
  colliderStyle?: PreviewColor;
}

export function fbxOutline(nodes: ModelNode[]): OutlineNode[] {
  return nodes.map(node => ({
    name: node.name, modelId: node.id, children: fbxOutline(node.children),
    parts: node.mesh ? [{id: node.id, collider: isColliderName(node.name) || isColliderName(node.mesh)}] : []
  }));
}

export function objLayout(source: string) {
  const nodes: OutlineNode[] = [];
  const parts: ({name: string; part: PreviewPart} | undefined)[] = [];
  const names = new Map<string, number>();
  const groupRows = new Map<string, OutlineNode>();
  let owner: OutlineNode, occurrence = 0, groups: string[] = [], block = -1;
  function startObject(name: string) {
    owner = {name, children: [], parts: []};
    occurrence = (names.get(name) ?? 0) + 1;
    names.set(name, occurrence);
    nodes.push(owner);
    groupRows.clear();
  }
  function groupRow(name: string) {
    if (!groupRows.has(name)) {
      const row = {name, children: [], parts: []};
      owner.children.push(row);
      groupRows.set(name, row);
    }
    return groupRows.get(name);
  }
  const seenParts = new Set<string>();
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*([ogflp])(?:\s+|$)/.exec(lines[i]);
    if (!match) continue;
    const kind = match[1];
    if (kind === "o" || kind === "g") {
      const name = lines[i].slice(match[0].length).split("#", 1)[0].trim();
      if (kind === "o") startObject(name || "(unnamed object)");
      else {
        if (!owner) startObject("(unnamed object)");
        groups = name ? [...new Set(name.split(/\s+/))] : [];
        groups.forEach(groupRow);
      }
      // OBJLoader splits geometry at either declaration. A unique block index survives repeated names.
      block = parts.length;
      parts.push(undefined);
      lines[i] = "o " + block;
    } else {
      if (block >= 0 && parts[block]) continue;
      if (!owner) startObject("(unnamed object)");
      if (block < 0) {
        block = parts.length;
        lines[i] = "o " + block + "\n" + lines[i];
      }
      const part = {id: JSON.stringify([owner.name, occurrence, ...groups]), collider: isColliderName(owner.name) || groups.some(isColliderName)};
      parts[block] = {name: groups.join(" ") || owner.name, part};
      if (seenParts.has(part.id)) continue;
      seenParts.add(part.id);
      owner.parts.push(part);
      groups.forEach(name => groupRow(name).parts.push(part));
    }
  }
  return {nodes, parts, text: lines.join("\n")};
}
