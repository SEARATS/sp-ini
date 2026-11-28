import { Euler, MathUtils, Matrix4, Quaternion, Vector3 } from "three";
import type { Catalog } from "./catalog";
import { field, point, type ElevatorPose, type EntityElevator, type EntityPart, type Vector } from "./entity-model";
import { readEntityDefinition } from "./entity-selection";
import type { IniSection, parse } from "./ini";
import type { Materials } from "./materials";

const sectionsByName = (doc:ReturnType<typeof parse>) => new Map(doc.sections.map(s=>[s.name.toLowerCase(),s]));
const value = (s:IniSection, key:string) => field(s,key)?.value;
const finite = (v:string | undefined) => v?.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined;

// Enumerate authored indices rather than allocating an array from an editable INI count.
function numbered(section:IniSection, pattern:RegExp, limit:number) {
  return (section?.keys ?? []).flatMap(k=>{
    const match = pattern.exec(k.name), index = match && Number(match[1]);
    return index>0 && index<=limit && String(index)===match[1] ? [index] : [];
  }).sort((a,b)=>a-b);
}

function poses(sequence:IniSection, part:EntityPart, warn:(message:string)=>void):ElevatorPose[] {
  const count = Number(value(sequence,"numberofsteps") ?? 1);
  if (!Number.isSafeInteger(count) || count<1 || count>10000) {
    warn("Cannot preview NumberOfSteps="+count+" in ["+sequence.name+"].");
    return [];
  }
  let position=part.position, rotation=part.rotation;
  const steps:ElevatorPose[]=[];
  for (let i=1;i<=count;i++) {
    const compact=value(sequence,"step"+i)?.split("|");
    const time=finite(compact ? compact[0] : value(sequence,"time"+i) ?? "0");
    if ((compact && compact.length!==4) || time===undefined) {
      warn("Unreadable step "+i+" in ["+sequence.name+"].");
      continue;
    }
    function vector(key:string, text:string | undefined, previous:Vector):Vector {
      const xyz=text?.split(",");
      return previous.map((prior,axis)=>{
        const component=(!compact ? value(sequence,key+"xyz"[axis]+i) : undefined) ?? xyz?.[axis];
        const number=finite(component);
        if (component && number===undefined && !/^none$/i.test(component.trim()))
          warn("Unreadable "+key+" component '"+component+"' in ["+sequence.name+"], step "+i+".");
        return number ?? prior;
      }) as Vector;
    }
    position=vector("position",compact ? compact[1] : value(sequence,"position"+i),position);
    rotation=vector("rotation",compact ? compact[2] : value(sequence,"rotation"+i),rotation);
    steps.push({time,position,rotation,linear:(compact?.[3] ?? value(sequence,"smoothness"+i))?.toLowerCase()==="linear",
      vectorPosition:!compact && !!field(sequence,"position"+i), quaternionRotation:!compact && !!field(sequence,"rotation"+i)});
  }
  return steps;
}

function matrix(pose:Pick<ElevatorPose,"position"|"rotation">, scale:Vector) {
  const [x,y,z]=pose.rotation.map(MathUtils.degToRad);
  return new Matrix4().compose(new Vector3(...pose.position),
    new Quaternion().setFromEuler(new Euler(x,y,z,"YXZ")),new Vector3(...scale));
}

// The embarked aircraft keeps its world pose when parented to the platform.
function raisedRide(ride:Vector, part:EntityPart, parts:Map<string,EntityPart>, steps:ElevatorPose[]) {
  let parent=parts.get(part.parent);
  const ancestors=new Matrix4();
  while (parent && parent.id!=="models") {
    ancestors.premultiply(matrix(parent,parent.scale));
    parent=parts.get(parent.parent);
  }
  const start=ancestors.clone().multiply(matrix(steps[0],part.scale));
  if (!start.determinant()) return;
  const end=ancestors.multiply(matrix(steps.at(-1),part.scale));
  return new Vector3(...ride).applyMatrix4(start.invert()).applyMatrix4(end).toArray() as Vector;
}

export async function elevatorTravel(doc:ReturnType<typeof parse>, parts:EntityPart[], catalog:Catalog, materials:Materials, warnings:Set<string>) {
  const sections=sectionsByName(doc), partById=new Map(parts.map(p=>[p.id,p]));
  const count=Number(value(sections.get("flightdeck"),"numberofelevators") ?? 0);
  const elevators=doc.sections.filter(s=>{
    const index=/^elevator([1-9]\d*)$/i.exec(s.name);
    return index && Number(index[1])<=count && !/^true$/i.test(value(s,"unused"));
  });
  const result:EntityElevator[]=[];
  if (!elevators.length) return result;
  const clips=new Map<string,Map<string,IniSection>>();
  const refs=sections.get("animations");
  for (const i of numbered(refs,/^animationfile_(\d+)$/i,Number(value(refs,"numberofanimationreferences") ?? 1))) {
    const name=value(refs,"animationfile_"+i).toLowerCase();
    const file=catalog.ordered(catalog.references.get("animations")?.get(name) ?? [])[0]?.file;
    const lib=file && await readEntityDefinition(file,catalog,materials);
    if (!lib) { warnings.add("Cannot read animation file "+name+".ini."); continue; }
    const local=sectionsByName(lib), registry=local.get("animations");
    const n=value(registry,"numberofanimations");
    const names=n===undefined ? registry?.keys.map(k=>k.value) ?? [] :
      numbered(registry,/^animation(\d+)$/i,Number(n)).map(i=>value(registry,"animation"+i));
    for (const entry of names) if (local.has(entry.toLowerCase())) clips.set(entry.toLowerCase(),local);
  }
  for (const elevator of elevators) {
    const mesh=value(elevator,"mesh") ?? elevator.name.replace(/^elevator/i,"Elevator_");
    if (!mesh || /^dummy$/i.test(mesh)) continue;
    const warn=(text:string)=>warnings.add("["+elevator.name+"] "+text);
    const part=partById.get(mesh.toLowerCase());
    if (!part) { warn("Missing platform "+mesh+". The game attaches aircraft to the ship root."); continue; }
    function track(key:string) {
      const name=value(elevator,key.toLowerCase());
      if (!name || /^(none|false)$/i.test(name)) return [];
      const local=clips.get(name.toLowerCase()), clip=local?.get(name.toLowerCase());
      if (!clip) { warn(key+"="+name+" is not a registered animation."); return []; }
      for (const i of numbered(clip,/^sequence(\d+)_model$/i,Number(value(clip,"numberofsequencestoplay") ?? 1))) {
        if (value(clip,"sequence"+i+"_model").toLowerCase()!==part.id) continue;
        const sequence=local.get(value(clip,"sequence"+i)?.toLowerCase());
        if (!sequence) continue;
        const steps=poses(sequence,part,warn);
        if (steps.some(s=>s.position.some((v,i)=>v!==steps[0].position[i]) || s.rotation.some((v,i)=>v!==steps[0].rotation[i]))) return steps;
        warn(name+" has no readable platform travel in ["+sequence.name+"].");
        return steps;
      }
      warn(name+" has no readable sequence targeting "+mesh+".");
      return [];
    }
    const raise=track("MoveUpAnimation"), lower=track("MoveDownAnimation");
    const ride=point((field(elevator,"rideposition") ?? field(elevator,"spawnposition"))?.value ?? "0,0,0");
    result.push({name:elevator.name,part:part.id,raise,lower,
      raisedRide:ride && raise.length ? raisedRide(ride,part,partById,raise) : undefined});
  }
  return result;
}
