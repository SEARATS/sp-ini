// pnpm run scan:units <Sea Power_Data/StreamingAssets/original>
import { readdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { family } from "../src/catalog";
import { parse } from "../src/ini";
import { numericValue, unitSectionId } from "../src/unit-context";

// Longest forms first. Match unit annotations, including phrases like "maximum speed in knots".
const forms: Record<string, string> = {
  "°/s": "degrees? (?:per second|/ ?s)|deg/s", "m/s²": "m/s(?:²|\\^?2)", "m/s": "m/s|met(?:er|re)s? per second",
  "dB/kt": "db per knot", "RPM": "revolutions per minute|rpm", "nmi": "nautical miles?|nmi|nm",
  "km/h": "km/h|kph", "kt": "knots?|kts?", "km": "kilomet(?:er|re)s?|km", "m": "met(?:er|re)s?|m",
  "ft": "feet|foot|ft", "mi": "statute miles?", "kg": "kilograms?|kg", "t": "tonnes?|tons", "N": "newtons?",
  "kW": "kilowatts?|kw", "Hz": "hertz|hz", "MHz": "mhz", "GHz": "ghz", "dB": "decibels?|dbs?",
  "°": "degrees?|deg", "rad": "radians?", "min": "minutes?|mins?", "ms": "milliseconds?|ms",
  "s": "seconds?|secs?|s", "h": "hours?|hrs?", "%": "percent(?:age)?|%"
};
const patterns = Object.entries(forms).map(([unit, form]) =>
  [unit, new RegExp(`^(?:${form})(?=$|[\\s.,;)])`, "i")] as const);

function annotation(comment: string, list: boolean) {
  const text = comment.replace(/^\s*(?:\/\/|#|;)\s*/, "").trim();
  if (/^min\.?$/i.test(text)) return;
  if (!list && /^additional flow noise per knot in db\b/i.test(text)) return "dB/kt";
  const prefix = /^(?:(?:min(?:imum)?|max(?:imum)?|default|base|output|seeker|passive|active|turn|launch|search|sound|peak|typical|target|radar|total)\s+)*(?:speed|turnrate|turn rate|field-of-view|range|altitude|depth|power|gain|time|delay|velocity|level|distance)\s+in\s+/i;
  const candidate = (list ? text : text.replace(prefix, "")).replace(/^in\s+/i, "");
  for (const [unit, regex] of patterns) {
    const match = regex.exec(candidate);
    if (!match) continue;
    const tail = candidate.slice(match[0].length).trim();
    if (!tail || tail === ".") return unit;
    // Only accept explanatory prose following an explicit scalar measurement.
    if (!list && candidate !== text && /^(?:[.,;]|for\b|where\b|at\b|before\b|after\b)/i.test(tail)) return unit;
    if (!list && /^nautical miles?\s+-\s+flavour text$/i.test(text)) return unit;
    return;
  }
}

async function scan(root: string) {
  const evidence = new Map<string, Set<string>>();
  let files = 0;
  async function visit(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { await visit(file); continue; }
      if (!entry.isFile() || !/\.ini$/i.test(entry.name)) continue;
      files++;
      const doc = parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
      const group = family(path.relative(root, file), doc);
      for (const section of doc.sections) {
        const context = unitSectionId(group, section);
        for (const field of section.keys) {
          if (!numericValue.test(field.value)) continue;
          const comment = doc.lines[field.line].slice(field.valueStart + field.value.length);
          const unit = annotation(comment, field.value.includes(","));
          if (!unit) continue;
          const key = JSON.stringify([group, context, field.name.toLowerCase(), field.value.includes(",") ? "list" : "scalar"]);
          if (!evidence.has(key)) evidence.set(key, new Set());
          evidence.get(key).add(unit);
        }
      }
    }
  }
  await visit(root);
  if (!files || !evidence.size) throw Error("No annotated vanilla INIs found in " + root);
  const rows = [...evidence.keys()].sort().filter(id => evidence.get(id).size === 1)
    .map(id => [...JSON.parse(id), ...evidence.get(id)]);
  const file = path.resolve(__dirname, "../src/unit-hints.json");
  await writeFile(file, "[\n" + rows.map(row => "  " + JSON.stringify(row)).join(",\n") + "\n]\n");
  console.log(`Scanned ${files} INIs, retained ${rows.length} unit rules, omitted ${evidence.size - rows.length} conflicts.`);
}
if (!process.argv[2]) throw Error("Pass the path to the vanilla original directory.");
scan(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1; });
