import { parse, type IniSection, type IniSource } from "./ini";

export type Vector = [number, number, number];
export type ObjectGroup = "Sensors" | "Weapons" | "Decoys" | "Combat systems" | "Ship systems" | "Flight deck" | "Magazines";
export interface EntityObject {
  id: string; name: string; group: ObjectGroup; system?: string; source?: IniSource;
  anchor?: string; position?: Vector; placement: string;
  firingArcs?: string; elevationArc?: string;
}
export interface EntityPart {
  id: string; name: string; parent?: string; geometry?: number; texture?: number;
  collider: boolean; primitive?: "box" | "sphere"; visible: boolean;
  position: Vector; rotation: Vector; scale: Vector;
  source?: IniSource; meshName?: string;
  missingDiffuse?: boolean;
  castShadows?:boolean;
  referencedBy?: string[];
  hullCollider?: boolean;
}
export interface EntityScene {
  parts: EntityPart[];
  objects?: EntityObject[];
  geometry: {positions: string; uvs: string; normals?:string}[];
  textures: {png:string; alpha:"opaque"|"cutout"|"blend"}[];
  warnings: string[];
}
export const field = (section: IniSection | undefined, name: string) => section?.keys.find(k => k.name.toLowerCase() === name);

export function expandEntityIni(text: string, uri?: string) {
  const doc = parse(text), output: string[] = [];
  const originalLines: number[] = [];
  function emit(line: number, value = doc.lines[line]) {
    output.push(value);
    originalLines.push(line);
  }
  let start = 0;
  for (const repeat of doc.modifiers.filter(m => m.name === "repeat")) {
    const end = doc.modifiers.find(m => m.line > repeat.line && m.name === "end");
    if (!end || repeat.line < start) throw Error("Invalid #!repeat block at line " + (repeat.line + 1));
    const vars = new Map([...repeat.args.matchAll(/(\w+)=([^\s;#]+)/g)].map(m => [m[1], m[2].split("|")]));
    const count = Math.max(0,...Array.from(vars.values(), v => v.length));
    if (!count || [...vars.values()].some(v => v.length !== 1 && v.length !== count))
      throw Error("Mismatched #!repeat values at line " + (repeat.line + 1));
    if (output.length + count * (end.line-repeat.line) > 200000) throw Error("Entity preview repeat expansion is too large.");
    for (; start < repeat.line; start++) emit(start);
    for (let i = 0; i < count; i++) for (let line = repeat.line+1; line < end.line; line++) {
      emit(line,doc.lines[line].replace(/\{(\w+)\}/g, (match,key) => vars.get(key)?.[i] ?? vars.get(key)?.[0] ?? match));
    }
    start = end.line+1;
  }
  const expanded = start ? parse(output.concat(doc.lines.slice(start)).join("\n")) : doc;
  if (uri) for (const section of expanded.sections) {
    const line = originalLines[section.line] ?? start + section.line - output.length;
    const header = doc.lines[line].trimStart().split("]",1)[0].slice(1);
    section.source = {uri,line,header};
  }
  return expanded;
}

export function entityParts(doc: ReturnType<typeof parse>, warnings: Set<string>) {
  const sections = new Map(doc.sections.map(s => [s.name.toLowerCase(),s]));
  const models = sections.get("models");
  if (!models) throw Error("This INI has no [Models] section to preview.");
  const hull = field(models,"resourcesmesh") || field(models,"mesh") || field(models,"assetbundlemesh");
  const hullColliders = new Set(models.keys.filter(key=>/^(resources|assetbundle)meshhullcollider$/i.test(key.name))
    .map(key=>key.value.toLowerCase()));
  const list = [{section: models, root: true, collider: false}];
  const seen = new Set([models.name.toLowerCase()]);
  for (const [section, keys, collider] of [
    [sections.get("submodels") || models, sections.has("submodels") ? /./ : /^submodel(?:\d|_)/i, false],
    [sections.get("colliders"), /^(?:mesh)?collider\d+$/i, true]
  ] as const) for (const entry of section?.keys || []) {
    if (!keys.test(entry.name)) continue;
    const id = entry.value.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    const target = sections.get(id);
    if (target) list.push({section:target, root:false, collider});
    else warnings.add("Missing section ["+entry.value+"]");
  }
  const parts = list.map(({section,root,collider}) => {
    const mesh = root ? hull : field(section,collider ? "collider" : "mesh");
    const shape = collider && (mesh?.value || "Box").toLowerCase();
    const parent = field(section,"parent")?.value.toLowerCase();
    function vector(key: string, fallback: Vector): Vector {
      const entry = field(section,key);
      if (!entry) return fallback;
      const numbers = entry.value.split(",").map(Number);
      if (numbers.length === 3 && numbers.every(Number.isFinite)) return numbers as Vector;
      warnings.add("Invalid "+key+" in ["+section.name+"]");
      return fallback;
    }
    const part: EntityPart = {
      id: section.name.toLowerCase(), name: root ? hull?.value || "Model" : section.name,
      parent: root ? undefined : !parent || parent === "visibleparent" || parent === hull?.value.toLowerCase() ? "models" : parent,
      collider, source:section.source, meshName:mesh?.value, primitive: shape === "box" || shape === "sphere" ? shape : undefined,
      position: vector("position",[0,0,0]), rotation: vector("rotation",[0,0,0]), scale: vector("scale",[1,1,1]),
      visible: !/^false$/i.test(field(section,"isvisible")?.value || "")
    };
    if (/^false$/i.test(field(section,"castshadows")?.value || "")) part.castShadows = false;
    if (collider) part.hullCollider = [section.name,mesh?.value].some(name => name &&
      (hullColliders.has(name.toLowerCase()) || /(?:^|[^a-z]|collider|coll|col)hull(?:$|[^a-z]|col)/i.test(name)));
    return {part, mesh, material:field(section,root ? "resourcesmaterial" : "material") || (root && field(section,"assetbundlematerial")) || undefined};
  });
  const byId = new Map(parts.map(({part}) => [part.id,part]));
  for (const section of doc.sections) {
    // In a collider definition, Collider names the shape or mesh. Elsewhere it links to definitions.
    if (byId.get(section.name.toLowerCase())?.collider) continue;
    const refs = field(section,"collider")?.value;
    if (!refs) continue;
    for (const id of new Set(refs.split(",").map(value=>value.trim().toLowerCase()))) {
      const collider = byId.get(id);
      if (collider?.collider) (collider.referencedBy ??= []).push(section.name);
    }
  }
  for (const {part} of parts) {
    const ancestors = new Set([part.id]);
    let parent = part.parent;
    while (parent) {
      if (ancestors.has(parent) || !byId.has(parent)) {
        warnings.add("Unresolved parent of ["+part.name+"]: "+parent);
        part.parent = "models";
        break;
      }
      ancestors.add(parent);
      parent = byId.get(parent).parent;
    }
  }
  return parts;
}

/** An export snippet supplies the children of the implicit VisibleParent. */
export function exportRigScene(ini: string, geometry: ReadonlyMap<string, number>): EntityScene {
  const warnings = new Set<string>();
  const parts = entityParts(parse("[Models]\n" + ini), warnings).map(({part, mesh}) => {
    if (mesh && !part.primitive && !/^dummy$/i.test(mesh.value)) {
      part.geometry = geometry.get(mesh.value);
      if (part.geometry === undefined) warnings.add("Missing mesh " + mesh.value);
    }
    return part;
  });
  return {parts, geometry:[], textures:[], warnings:[...warnings]};
}

export function entityObjects(doc: ReturnType<typeof parse>, parts: EntityPart[]): EntityObject[] {
  const anchors = new Map(parts.map(part => [part.id,part.id]));
  const root = parts.find(part => part.id === "models");
  if (root) anchors.set(root.name.toLowerCase(),root.id);
  const magazines = new Set(doc.sections.flatMap(section => (field(section,"associatedmagazine")?.value || "")
    .toLowerCase().split(",").map(name=>name.trim()).filter(Boolean)));
  const groups: [RegExp, ObjectGroup][] = [
    [/^SensorSystem\d+$/i,"Sensors"], [/^WeaponSystem\d+$/i,"Weapons"], [/^CombatSystem\d+$/i,"Combat systems"],
    [/^(?:ControlSystem|MainPowerSystem|(?:PropulsionSystem|RudderSystem)\d+)$/i,"Ship systems"],
    [/^DecoySystem\d+$/i,"Decoys"], [/^(?:LaunchPoint|RecoveryPoint|Elevator)\d+$/i,"Flight deck"],
    [/^Magazine\d+$/i,"Magazines"]
  ];
  const objects: EntityObject[] = [];
  for (const section of doc.sections) {
    const magazine = magazines.has(section.name.toLowerCase()) || /magazine$/i.test(field(section,"moduletype")?.value || "");
    const group = magazine ? "Magazines" : groups.find(([pattern]) => pattern.test(section.name))?.[1];
    if (!group) continue;
    const obj: EntityObject = {id:"object:"+section.name.toLowerCase(),name:section.name,group,source:section.source,
      firingArcs:group==="Weapons" ? field(section,"firingarcs")?.value : undefined,
      elevationArc:group==="Weapons" ? field(section,"elevationarc")?.value : undefined,
      system:field(section,"systemname")?.value || field(section,"type")?.value,placement:"No spatial reference"};
    objects.push(obj);
    const mount = field(section,"mount")?.value;
    const namedMount = mount && !/^dummy$/i.test(mount);
    const offset = !namedMount && (field(section,"mountposition") || field(section,"attachmentpointposition") ||
      field(section,"position") || field(section,"spawnposition"));
    const collider = !namedMount && !offset && field(section,"collider")?.value;
    const anchor = namedMount ? mount : collider || field(section,"mountparent")?.value || "models";
    if (!namedMount && !collider && !offset) continue;
    obj.anchor = anchors.get(anchor.toLowerCase());
    if (!obj.anchor) { obj.placement = "Unresolved anchor: "+anchor; continue; }
    const coords = offset ? offset.value.split(",").map(v=>v.trim() ? Number(v) : NaN) : [0,0,0];
    if (coords.length !== 3 || !coords.every(Number.isFinite)) { obj.placement = "Invalid "+offset.name; continue; }
    obj.position = coords as Vector;
    obj.placement = namedMount ? "Mount="+mount : collider ? "Collider="+collider : offset.name+"="+offset.value;
  }
  return objects;
}
