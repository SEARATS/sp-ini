import { DiagnosticSeverity, Range, type Diagnostic } from "vscode-languageserver/node";
import { type IniEntry, type parse } from "./ini";
import { validValue } from "./values";

interface IndexedList {
  count: string;
  item: string;
  keys: RegExp;
  defaultCount?: number;
}

const colliders: IndexedList[] = ["Collider", "MeshCollider"].map(item => ({
  count: "NumberOf" + item + "s", item, keys: new RegExp("^" + item + "([1-9]\\d*)$", "i"), defaultCount: 0
}));
const submodels: IndexedList = {count:"NumberOfSubModels", item:"SubModel", keys:/^submodel([1-9]\d*)$/i, defaultCount:0};
const animations: IndexedList = {count:"NumberOfAnimations", item:"Animation", keys:/^animation([1-9]\d*)$/i};
const sequences: IndexedList = {count:"NumberOfSequencesToPlay", item:"Sequence", keys:/^sequence([1-9]\d*)$/i, defaultCount:1};
const steps: IndexedList = {count:"NumberOfSteps", item:"step ", keys:/^(?:step|time|position[xyz]?|rotation[xyz]?|smoothness)([1-9]\d*)$/i, defaultCount:1};

function compareList(keys: IniEntry[], list: IndexedList, partial: boolean): Diagnostic[] {
  const countKeys = keys.filter(k => k.name.toLowerCase() === list.count.toLowerCase());
  if (countKeys.length > 1 || (partial && !countKeys.length)) return [];
  const key = countKeys[0];
  if (key && !validValue("count", key.value)) return [];
  const count = key ? Number(key.value) : list.defaultCount;
  if (count === undefined || count < 0 || count > 2147483647) return [];

  const indexed = new Map<number, IniEntry>();
  for (const entry of keys) {
    const match = list.keys.exec(entry.name);
    if (match && entry.value) indexed.set(Number(match[1]), entry);
  }
  const indices = [...indexed.keys()].sort((a,b) => a-b);
  const issues: Diagnostic[] = [];
  function warn(entry: IniEntry, code: string, message: string) {
    issues.push({range:Range.create(entry.line, entry.valueStart, entry.line, entry.valueStart + entry.value.length),
      severity:DiagnosticSeverity.Warning, source:"Sea Power INI", code, message});
  }
  const declared = key ? key.name + "=" + key.value : list.count + " defaults to " + count;
  // Compare actual indices, so a hole and a clipped entry can both be reported without iterating to the declared count.
  const clipped = indices.find(i => i > count);
  if (clipped !== undefined) warn(key ?? indexed.get(clipped), "count-too-small",
    declared + ". Sea Power skips " + list.item + clipped + " and any higher indices.");
  if (key && !partial) {
    let missing = 1;
    for (const index of indices) {
      if (index !== missing) break;
      missing++;
    }
    if (missing <= count) warn(key, "count-too-large", declared + ", but " + list.item + missing + " has no definition.");
  }
  return issues;
}

export function countDiagnostics(doc: ReturnType<typeof parse>, group: string): Diagnostic[] {
  // A patch can supply only part of a list. A literal count still gets its independent numeric checks.
  const partial = doc.modifiers.some(m => /^(extend|prepend|copy|alias)$/.test(m.name));
  const sections = new Map<string, IniEntry[]>();
  for (const section of doc.sections) {
    const name = section.name.toLowerCase();
    if (sections.has(name)) sections.get(name).push(...section.keys);
    else sections.set(name, [...section.keys]);
  }
  const issues: Diagnostic[] = [];
  for (const [name, keys] of sections) {
    if (keys.some(k => k.repeated || k.name.includes("{"))) continue;
    if (name === "colliders") {
      for (const list of colliders) issues.push(...compareList(keys, list, partial));
    } else if (name === "models" && (group === "ammunition" || !sections.has("submodels"))) {
      const list = group === "biologic" ? {...submodels, defaultCount:1} : submodels;
      issues.push(...compareList(keys, list, partial));
    } else if (group === "animations") {
      if (name === "animations") issues.push(...compareList(keys, animations, partial));
      else issues.push(...compareList(keys, sequences, partial), ...compareList(keys, steps, partial));
    }
  }
  return issues;
}
