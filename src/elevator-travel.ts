import type { Catalog } from "./catalog";
import { field, point } from "./entity-model";
import { readEntityDefinition } from "./entity-selection";
import type { IniSection, parse } from "./ini";
import type { Materials } from "./materials";

/** Vertical travel from the lowered to the raised pose of each elevator mesh. */
export async function elevatorTravel(doc:ReturnType<typeof parse>, catalog:Catalog, materials:Materials) {
  const lifts = new Map<string,number>();
  const elevators = doc.sections.filter(s=>/^elevator\d+$/i.test(s.name) && field(s,"moveupanimation"));
  if (!elevators.length) return lifts;
  const library = new Map(doc.sections.map(s=>[s.name.toLowerCase(),s]));
  for (const ref of library.get("animations")?.keys ?? []) {
    if (!/^animationfile_?\d+$/i.test(ref.name)) continue;
    const name = ref.value.replace(/\.ini$/i,"").toLowerCase();
    const file = catalog.ordered(catalog.references.get("animations")?.get(name) ?? [])[0]?.file;
    if (!file) continue;
    const animation = await readEntityDefinition(file,catalog,materials);
    for (const section of animation?.sections ?? []) library.set(section.name.toLowerCase(),section);
  }
  function height(section:IniSection, step:number) {
    const axis = field(section,"positiony"+step);
    return axis ? Number(axis.value) : point(field(section,"position"+step)?.value)?.[1];
  }
  for (const elevator of elevators) {
    const name = elevator.name.toLowerCase();
    const mesh = field(elevator,"mesh")?.value.toLowerCase() ?? name.replace("elevator","elevator_");
    const animation = library.get(field(elevator,"moveupanimation").value.toLowerCase());
    for (const key of animation?.keys ?? []) {
      const seq = /^(sequence\d+)_model$/i.exec(key.name);
      if (!seq || key.value.toLowerCase()!==mesh) continue;
      const steps = library.get(field(animation,seq[1].toLowerCase())?.value.toLowerCase());
      const count = Number(field(steps,"numberofsteps")?.value);
      if (!steps || !Number.isInteger(count) || count<2) continue;
      const travel = height(steps,count)-height(steps,1);
      if (Number.isFinite(travel)) {
        lifts.set(name,travel);
        break;
      }
    }
  }
  return lifts;
}
