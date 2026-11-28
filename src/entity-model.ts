import { parse, type IniSection, type IniSource } from "./ini";

export type Vector = [number, number, number];
export interface EntitySpin { part: string; axis: "x" | "y" | "z"; rpm: number }
export type ObjectGroup = "Sensors" | "Weapons" | "Decoys" | "Combat systems" | "Ship systems" | "Flight deck" | "Magazines";
export interface EntityObject {
  id: string; name: string; group: ObjectGroup; system?: string; source?: IniSource;
  anchor?: string; position?: Vector; placement: string;
  firingArcs?: string; elevationArc?: string;
  route?: {kind:"taxiPaths" | "airPaths"; points:Vector[]};
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
  spins?: EntitySpin[];
  objects?: EntityObject[];
  geometry: {positions: string; uvs: string; normals?:string}[];
  textures: {png:string; alpha:"opaque"|"cutout"|"blend"}[];
  warnings: string[];
}
export const field = (section: IniSection | undefined, name: string) => section?.keys.find(k => k.name.toLowerCase() === name);
export const deckPointSection = /^(elevator|launchpoint|recoverypoint|taxipoint)\d+$/i;

export function point(text:string | undefined):Vector | undefined {
  const coords = text?.split(",").map(v=>v.trim() ? Number(v) : NaN);
  if (coords?.length===3 && coords.every(Number.isFinite)) return coords as Vector;
}

function airborneRoutes(sections:Map<string,IniSection>, anchor:string | undefined) {
  const deck = sections.get("flightdeck"), routes:EntityObject[] = [];
  if (!deck || !anchor) return routes;
  // FlightDeck and RecoveryPoint use different vertical conversions in the game.
  const mile = 27.559496, holdFoot = 0.00453571, circuitFoot = mile * 0.000189394;
  function waypoints(text:string | undefined, foot:number):Vector[] {
    const points = text?.split("|").map(point);
    return points?.every(Boolean) ? points.map(([x,y,z])=>[x*mile,y*foot,z*mile]) : [];
  }
  function add(section:IniSection, label:string, points:Vector[]) {
    routes.push({id:"object:"+section.name.toLowerCase()+"/"+label.toLowerCase(),name:section.name+" · "+label,
      group:"Flight deck",source:section.source,anchor,position:points[0],placement:label,route:{kind:"airPaths",points}});
  }
  for (const key of ["HoldWaypoints","LargeHoldWaypoints","HelicopterHoldWaypoints"]) {
    const points = waypoints(field(deck,key.toLowerCase())?.value,holdFoot);
    if (points.length) add(deck,key,points.length>1 ? [...points,points[0]] : points);
  }
  const count = Number(field(deck,"numberofrecoverypoints")?.value ?? 0);
  for (const section of sections.values()) {
    const index = /^recoverypoint([1-9]\d*)$/i.exec(section.name);
    if (!index || Number(index[1])>count) continue;
    const touchdown = point(field(section,"position")?.value);
    if (!touchdown) continue;
    const [x,y,z] = touchdown;
    const types = (field(section,"allowedtype")?.value ?? "").toLowerCase().split(",").map(type=>type.trim());
    const plane = types.includes("plane") || types.includes("stol");
    const circuit = field(section,"circuitwaypoints")?.value;
    if (plane) {
      const yaw = Number(field(section,"rotation")?.value ?? 0)*Math.PI/180;
      if (Number.isFinite(yaw)) {
        // Approach.CreateWaypoints lays out four fixes behind the recovery point.
        const final:Vector[] = [1,0.75,0.5,0.25].map(f=>{
          const distance = f*2*mile;
          return [x-distance*Math.sin(yaw),y+distance*Math.tan(3.5*Math.PI/180),z-distance*Math.cos(yaw)];
        });
        add(section,"Fixed-wing approach",[...waypoints(circuit,circuitFoot),...final,touchdown]);
        const large = field(section,"largecircuitwaypoints")?.value;
        if (large && large!==circuit) add(section,"Large aircraft approach",[...waypoints(large,circuitFoot),...final,touchdown]);
      }
    }
    if (types.includes("helicopter") || (!plane && types.includes("vtol"))) {
      const [dx,dy,dz] = point(field(section,"exitposition")?.value) ?? [-0.0744,0.372,-0.0744];
      const final:Vector[] = [[x+dx,y+dy,z+dz],touchdown];
      const heli = field(section,"helicoptercircuitwaypoints")?.value ?? circuit;
      const shared = types.includes("helicopter") && !plane && types.includes("vtol") && heli===circuit;
      if (types.includes("helicopter")) add(section,shared ? "Helicopter / VTOL approach" : "Helicopter approach",[...waypoints(heli,circuitFoot),...final]);
      if (!plane && types.includes("vtol") && !shared)
        add(section,"VTOL approach",[...waypoints(circuit,circuitFoot),...final]);
    }
  }
  return routes;
}

function taxiRoute(section:IniSection, sections:Map<string,IniSection>, lifts:ReadonlyMap<string,number>) {
  function endpoint(key:"from" | "to") {
    const name = field(section,key)?.value.toLowerCase();
    const target = sections.get(name);
    if (!target) return;
    if (/^elevator\d+$/i.test(name)) {
      const recovery = key==="to" && field(target,"recoveryposition");
      const p = point((recovery || field(target,"rideposition") || field(target,"spawnposition"))?.value);
      if (p) p[1] += lifts.get(name) ?? 0;
      return p;
    }
    if (/^(launchpoint|recoverypoint|taxipoint)\d+$/i.test(name)) return point(field(target,"position")?.value);
  }
  const via = field(section,"waypoints")?.value;
  const points = [endpoint("from"),...(via ? via.split("|").map(point) : []),endpoint("to")];
  if (!points.every(p=>p!==undefined)) return;
  for (const [index,key] of [[0,"from"],[points.length-1,"to"]] as const) {
    const name = field(section,key)?.value.toLowerCase();
    const target = sections.get(name);
    // EmbarkElevator uses deck height on recovery. The adjacent deck point also
    // provides a raised-stop estimate when the animation has no readable translation.
    if (/^elevator\d+$/i.test(name) && field(target,"moveupanimation") && (key==="to" || !lifts.has(name)))
      points[index][1] = points[index===0 ? 1 : index-1][1];
  }
  return points;
}

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

export function entityObjects(doc: ReturnType<typeof parse>, parts: EntityPart[], lifts:ReadonlyMap<string,number> = new Map()): EntityObject[] {
  const anchors = new Map(parts.map(part => [part.id,part.id]));
  const root = parts.find(part => part.id === "models");
  if (root) anchors.set(root.name.toLowerCase(),root.id);
  const magazines = new Set(doc.sections.flatMap(section => (field(section,"associatedmagazine")?.value || "")
    .toLowerCase().split(",").map(name=>name.trim()).filter(Boolean)));
  const groups: [RegExp, ObjectGroup][] = [
    [/^SensorSystem\d+$/i,"Sensors"], [/^WeaponSystem\d+$/i,"Weapons"], [/^CombatSystem\d+$/i,"Combat systems"],
    [/^(?:ControlSystem|MainPowerSystem|(?:PropulsionSystem|RudderSystem)\d+)$/i,"Ship systems"],
    [/^DecoySystem\d+$/i,"Decoys"], [/^(?:FlightDeck|(?:LaunchPoint|RecoveryPoint|Elevator|TaxiPoint|TaxiPath)\d+)$/i,"Flight deck"],
    [/^Magazine\d+$/i,"Magazines"]
  ];
  const objects: EntityObject[] = [];
  const sections = new Map(doc.sections.map(s=>[s.name.toLowerCase(),s]));
  const taxiPaths = Number(field(sections.get("flightdeck"),"numberoftaxipaths")?.value ?? 0);
  for (const section of doc.sections) {
    const magazine = magazines.has(section.name.toLowerCase()) || /magazine$/i.test(field(section,"moduletype")?.value || "");
    const group = magazine ? "Magazines" : groups.find(([pattern]) => pattern.test(section.name))?.[1];
    if (!group) continue;
    const obj: EntityObject = {id:"object:"+section.name.toLowerCase(),name:section.name,group,source:section.source,
      firingArcs:group==="Weapons" ? field(section,"firingarcs")?.value : undefined,
      elevationArc:group==="Weapons" ? field(section,"elevationarc")?.value : undefined,
      system:field(section,"systemname")?.value || field(section,"type")?.value,placement:"No spatial reference"};
    objects.push(obj);
    const taxi = /^taxipath([1-9]\d*)$/i.exec(section.name);
    if (taxi) {
      const from = field(section,"from")?.value, to = field(section,"to")?.value;
      const points = Number(taxi[1])<=taxiPaths && taxiRoute(section,sections,lifts);
      if (points) obj.route = {kind:"taxiPaths",points};
      obj.placement = [from,to].filter(Boolean).join(" → ");
      obj.position = obj.route?.points[0];
      obj.anchor = root?.id;
      continue;
    }
    if (deckPointSection.test(section.name)) {
      const key = /^elevator/i.test(section.name) ? "SpawnPosition" : "Position";
      const value = field(section,key.toLowerCase())?.value;
      obj.anchor = root?.id;
      obj.position = point(value);
      obj.placement = obj.position ? key+"="+value : "Missing or invalid "+key;
      continue;
    }
    const mount = field(section,"mount")?.value;
    const namedMount = mount && !/^dummy$/i.test(mount);
    const offset = !namedMount && (field(section,"mountposition") || field(section,"attachmentpointposition") ||
      field(section,"position") || field(section,"spawnposition"));
    const collider = !namedMount && !offset && field(section,"collider")?.value;
    const anchor = namedMount ? mount : collider || field(section,"mountparent")?.value || "models";
    if (!namedMount && !collider && !offset) continue;
    obj.anchor = anchors.get(anchor.toLowerCase());
    if (!obj.anchor) { obj.placement = "Unresolved anchor: "+anchor; continue; }
    obj.position = offset ? point(offset.value) : [0,0,0];
    if (!obj.position) { obj.placement = "Invalid "+offset.name; continue; }
    obj.placement = namedMount ? "Mount="+mount : collider ? "Collider="+collider : offset.name+"="+offset.value;
  }
  objects.push(...airborneRoutes(sections,root?.id));
  return objects;
}
