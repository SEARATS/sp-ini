import type { InlayHint, Range } from "vscode-languageserver";
import { family } from "./catalog";
import { parse } from "./ini";
import rules from "./unit-hints.json";
import { flightDeckUnit, numericValue, unitSectionId } from "./unit-context";

const knownUnits = new Map(rules.map(([group, section, key, shape, unit]) => [[group, section, key, shape].join("/"), unit]));

export async function unitHints(doc: ReturnType<typeof parse>, file: string, range: Range,
  inheritedRangeUnit?: () => Promise<string | undefined>): Promise<InlayHint[]> {
  const group = family(file, doc);
  const hints: InlayHint[] = [];
  function add(line: number, character: number, label: string) {
    if ((line === range.start.line && character < range.start.character) ||
        (line === range.end.line && character > range.end.character)) return;
    hints.push({ position: { line, character }, label, paddingLeft: true });
  }
  for (const section of doc.sections) {
    if (section.line > range.end.line) break;
    if (section.keys.at(-1)?.line < range.start.line) continue;
    const context = unitSectionId(group, section);
    for (const { line, name, value, valueStart } of section.keys) {
      if (line < range.start.line || line > range.end.line) continue;
      const key = name.toLowerCase();
      const end = valueStart + value.length;
      const deckUnit=(group==="vessels" || group==="land_units") && flightDeckUnit(context,key,value);
      if (deckUnit) { add(line,end,deckUnit); continue; }
      if (!numericValue.test(value)) continue;
      if (group === "aircraft" && context === "performance" && key === "speedandrange_cruise") {
        const parts = value.split(",");
        if (parts.length !== 2) continue;
        add(line, valueStart + parts[0].trimEnd().length, Number(parts[0]) > 10 ? "kt" : "Mach");
        let units = section.keys.find(k => k.name.toLowerCase() === "rangeunits")?.value;
        const base = doc.modifiers.find(m => /^(copy|alias|extend|prepend)$/.test(m.name));
        if (base && (!units || base.name === "prepend")) units = await inheritedRangeUnit?.();
        if (units || !base) add(line, end, units?.toLowerCase() === "km" ? "km" : "nmi");
        continue;
      }
      const label = knownUnits.get([group, context, key, value.includes(",") ? "list" : "scalar"].join("/"));
      if (label) add(line, end, label);
    }
  }
  return hints;
}
