import type { ObjectGroup } from "./entity-model";

export const previewColors = { collider:"#ff833d", unassigned:"#c0c0c0", hull:"#ffffff", sensor:"#53c8fa", weapon:"#ff4444", magazine:"#ff833d", object:"#c6a2ff" } as const;
export type PreviewColor = keyof typeof previewColors;

export function objectColor(group: ObjectGroup): PreviewColor {
  return group === "Sensors" ? "sensor" : group === "Weapons" ? "weapon" : group === "Magazines" ? "magazine" : "object";
}
