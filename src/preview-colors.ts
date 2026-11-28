import type { ObjectGroup } from "./entity-model";

export const previewColors = { collider:"#ff833d", unassigned:"#c0c0c0", hull:"#ffffff", sensor:"#ffdc52", flight:"#478eea", weapon:"#ff4444", magazine:"#ff833d", object:"#c6a2ff" } as const;
export const deckPointColor = "#21539b";
export const weaponArcColors = {bearing:0xff8c32,elevation:0xffb368} as const;
export type PreviewColor = keyof typeof previewColors;

export function objectColor(group: ObjectGroup): PreviewColor {
  return group === "Flight deck" ? "flight" : group === "Sensors" ? "sensor" : group === "Weapons" ? "weapon" : group === "Magazines" ? "magazine" : "object";
}
