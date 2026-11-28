import type { EntityScene, EntityObject } from "./entity-model";

export const entityModes = ["Everything", "Weapons", "Flight", "Sensors", "Propulsion"] as const;
export type EntityMode = typeof entityModes[number];

function systemMode(object: EntityObject): EntityMode | undefined {
  switch (object.group) {
    case "Weapons": case "Magazines": case "Decoys": case "Combat systems": return "Weapons";
    case "Sensors": return "Sensors";
    case "Flight deck": return "Flight";
    case "Ship systems":
      if (/^(MainPowerSystem|(?:PropulsionSystem|RudderSystem)\d+)$/i.test(object.name)) return "Propulsion";
  }
}

// Keep visual meshes for orientation. A shared collider belongs in every mode that uses it.
export function excludedOverlays(scene: EntityScene, mode: EntityMode): Set<string> {
  const excluded = new Set<string>();
  if (mode === "Everything") return excluded;
  const owners = new Set<string>();
  for (const object of scene.objects ?? []) {
    if (systemMode(object) === mode) owners.add(object.name.toLowerCase());
    else excluded.add(object.id);
  }
  for (const part of scene.parts) {
    if (part.collider && !part.referencedBy?.some(name => owners.has(name.toLowerCase()))) excluded.add(part.id);
  }
  return excluded;
}
