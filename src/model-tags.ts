import { flatten, type ModelNode } from "./hierarchy";
import { meshFlagMatcher } from "./mesh-flags";
import { colliderType, tagOverride, type MeshTags } from "./mesh-names";
import { primitiveTags, specialRoles } from "./export-roles";

/** Infer model-wide roles without writing suggestions to the user's sidecar. */
export function modelTags(roots: ModelNode[], filename: string, saved: MeshTags, rules: unknown): MeshTags {
  const tags = new Map(saved), match = meshFlagMatcher(rules,saved);
  const parts = flatten(roots).filter(n => n.mesh).map(n => {
    const names = [n.mesh,n.name], flags = match(...names).map(f => f.label);
    return {n,names,flags,collider:colliderType(saved,...names) || flags.includes("Collider")};
  });
  type Part = typeof parts[number];
  const stem = filename.replace(/^.*[\\/]/,"").replace(/\.[^.]+$/,"").toLowerCase();
  const prefixes = new Map<string,number>();
  for (const p of parts) {
    const tokens = p.n.name.toLowerCase().split("_");
    for (let i=1; i<tokens.length; i++) {
      const prefix = tokens.slice(0,i).join("_");
      prefixes.set(prefix,(prefixes.get(prefix) ?? 0) + 1);
    }
  }
  const infer = (label: typeof specialRoles[number], score: (part: Part) => number) => {
    const pinned = parts.find(p => p.flags.includes(label));
    if (pinned) return pinned;
    if (Array.isArray(rules) && rules.some(rule => rule?.label === label && rule.enabled === false)) return;
    let best: Part, bestScore = 0;
    for (const p of parts) {
      if (tagOverride(saved,label,p.names) === false) continue;
      const value = score(p);
      if (value > bestScore || (value > 0 && value === bestScore && (p.n.triangles || 0) > (best.n.triangles || 0))) {
        best = p; bestScore = value;
      }
    }
    if (best) tags.set(best.n.name,new Map(tags.get(best.n.name)).set(label,true));
    return best;
  };
  const primary = infer("Primary mesh", p => {
    if (p.collider || p.flags.some(f => ["LOD","Damaged","Primary damage mesh","Hull collider"].includes(f))) return 0;
    const names = p.names.map(s => s.toLowerCase());
    if (names.includes(stem)) return 5;
    if (p.n.triangles && (prefixes.get(names[1]) ?? 0) >= Math.max(2,parts.length / 3)) return 4;
    if (names.some(s => /(?:^|_)(?:hull|fuselage)$/.test(s))) return 3;
    return p.flags.every(f => Object.hasOwn(primitiveTags,f)) && p.n.triangles > 0 ? 1 : 0;
  });
  if (primary) infer("Primary damage mesh", p => p !== primary && !p.collider &&
    p.names.some(s => primary.names.some(n => s.toLowerCase() === n.toLowerCase() + "_d")) ? 1 : 0);
  infer("Hull collider", p => {
    if (!p.collider || !p.names.some(s => /(?:^|_)hull(?:_|$)/i.test(s))) return 0;
    // Numbered hull sections are ordinary colliders even when they are large.
    return p.names.some(s => /(?:^|_)(?:coll?(?:ider)?_hull|hull_coll?(?:ider)?)$/i.test(s)) ? 1 : 0;
  });
  return tags;
}
