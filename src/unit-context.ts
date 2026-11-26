import { sectionGroup, type IniSection } from "./ini";

export function unitSectionId(family: string, section: IniSection) {
  if (family === "sensors.ini") {
    const kind = section.keys.find(k => k.name.toLowerCase() === "kind")?.value;
    if (kind) return "kind:" + kind.toLowerCase();
  }
  return sectionGroup(section.name);
}

const number = /[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.source;
export const numericValue = new RegExp(`^${number}(?:\\s*,\\s*${number})*$`, "i");
