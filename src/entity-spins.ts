import type { Catalog } from "./catalog";
import { field, type EntityPart, type EntitySpin } from "./entity-model";
import { readEntityDefinition } from "./entity-selection";
import type { parse } from "./ini";
import type { Materials } from "./materials";

export async function entitySpins(doc:ReturnType<typeof parse>, parts:EntityPart[], catalog:Catalog, materials:Materials) {
  const mounts = new Set(parts.filter(p=>!p.collider && p.id!=="models").map(p=>p.id));
  const spins = new Map<string,EntitySpin>();
  function spin(name:string | undefined, axis:EntitySpin["axis"], rpm:number) {
    const part = name?.toLowerCase();
    if (mounts.has(part) && Number.isFinite(rpm) && rpm && !spins.has(part)) spins.set(part,{part,axis,rpm});
  }

  const controls = doc.sections.find(s=>/^flightcontrols$/i.test(s.name));
  const count = Number(field(controls,"numberofrotors")?.value ?? 1);
  for (const key of controls?.keys || []) {
    const rotor = /^rotor([1-9]\d*)_model$/i.exec(key.name);
    if (!rotor || !Number.isInteger(count) || Number(rotor[1]) > count) continue;
    const value = (suffix:string)=>field(controls,"rotor"+rotor[1]+"_"+suffix)?.value;
    const axis = value("rotationaxis")?.toLowerCase();
    spin(key.value,axis==="x" || axis==="y" ? axis : "z",Number(value("rpm") ?? 300) * Number(value("direction") ?? -1));
  }

  const sensors = catalog.references.get("sensors");
  const definitions = new Map<string,Awaited<ReturnType<typeof readEntityDefinition>>>();
  for (const sensor of doc.sections) {
    if (!/^sensorsystem\d+$/i.test(sensor.name) || !/^radar$/i.test(field(sensor,"type")?.value ?? "")) continue;
    const mount = field(sensor,"mount")?.value.toLowerCase();
    if (!mounts.has(mount) || mount==="dummy") continue;
    const name = field(sensor,"systemname")?.value.toLowerCase();
    const file = catalog.ordered(sensors?.get(name) || [])[0]?.file;
    if (!file) continue;
    if (!definitions.has(file.uri)) definitions.set(file.uri,await readEntityDefinition(file,catalog,materials));
    const radar = definitions.get(file.uri)?.sections.find(s=>s.name.toLowerCase()===name);
    if (!/^search$/i.test(field(radar,"type")?.value ?? "")) continue;
    spin(mount,"y",Number(field(radar,"rpm")?.value ?? 15) * Number(field(radar,"rotationdirection")?.value ?? 1));
  }
  return [...spins.values()];
}
