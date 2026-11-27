export const exportCategories = ["Mesh", "Collider", "LOD", "Damaged", "Helper"] as const;
export type ExportCategory = typeof exportCategories[number];
export const specialRoles = ["Primary mesh", "Primary damage mesh", "Hull collider"] as const;
export type ExportChoice = ExportCategory | typeof specialRoles[number] | "Skip";
export function lodLevel(name:string, mesh:string) {
  return Number(/_lod(\d+)$/i.exec(name)?.[1] ?? /_lod(\d+)$/i.exec(mesh)?.[1]);
}
export function categoryFor(role: ExportChoice) {
  switch (role) {
    case "Primary mesh": return "Mesh";
    case "Primary damage mesh": return "Damaged";
    case "Hull collider": return "Collider";
    default: return role;
  }
}
