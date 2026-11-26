import { CodeActionKind, Range, TextEdit, type CodeAction, type Diagnostic } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { IniEntry, parse } from "./ini";
import { ignoredRules } from "./ini-edits";
import { submodelNames } from "./catalog";

type Ini = ReturnType<typeof parse>;
export const placementCode = "ignored-section-key";

// These roles and keys come from the vanilla unit loaders. An unknown key or
// an unclassified section is insufficient evidence for an ignored-key warning.
const sectionRoles = {
  sensor: /^SensorSystem\d+(?:_.+)?$/i,
  weapon: /^WeaponSystem\d+(?:_.+)?$/i,
  sensorList: /^SensorSystems$/i,
  weaponList: /^WeaponSystems$/i
};
type Role = keyof typeof sectionRoles | "submodel";
const placementRules: { keys: RegExp; owners: Role[]; destination: string; section?: string }[] = [
  { keys: /^(Material|ResourcesMaterialFolder|MaterialTexture(?:Diffuse|Specular|Normal)|Mesh|ResourcesMeshFolder|RootMesh|CastShadows|DisplayWhenTransport)$/i,
    owners: ["submodel"], destination: "the visible submodel section" },
  { keys: /^(FiringArcs|ElevationArc|PreferredArcs|ContainerBase|AssociatedMagazine)$/i,
    owners: ["weapon"], destination: "the weapon system section" },
  { keys: /^(Mount|MountPosition)$/i, owners: ["sensor","weapon"], destination: "the sensor or weapon system section" },
  { keys: /^NumberOfSensorSystems$/i, owners: ["sensorList"], destination: "[SensorSystems]", section: "SensorSystems" },
  { keys: /^NumberOfWeaponSystems$/i, owners: ["weaponList"], destination: "[WeaponSystems]", section: "WeaponSystems" }
];

export function misplacedKey(key: IniEntry, parts: Set<string>) {
  if (!key.section) return;
  const name=key.section.name;
  const roles:Role[]=[];
  for (const role of Object.keys(sectionRoles) as (keyof typeof sectionRoles)[]) {
    if (sectionRoles[role].test(name)) roles.push(role);
  }
  if (parts.has(name.toLowerCase())) roles.push("submodel");
  if (!roles.length) return;
  const rule=placementRules.find(r=>r.keys.test(key.name));
  if (rule && !roles.some(role=>rule.owners.includes(role))) return rule;
}

export function moveMisplacedKey(document: TextDocument, doc: Ini, diagnostic: Diagnostic, versionedEdits: boolean): CodeAction | undefined {
  if (diagnostic.source !== "Sea Power INI" || diagnostic.code !== placementCode) return;
  const { line, character } = diagnostic.range.start;
  const key = doc.entries.find(entry => entry.line === line && entry.start === character);
  if (!key || key.repeated || ignoredRules(doc.lines[line]).includes(placementCode)) return;
  const parts = submodelNames(doc);
  const rule = misplacedKey(key, parts);
  if (!rule) return;
  if (doc.sections.some(section => section !== key.section && section.name.toLowerCase() === key.section.name.toLowerCase())) return;
  let name=rule.section?.toLowerCase();
  if (!name && rule.owners.includes("submodel")) {
    const mounts=key.section.keys.filter(entry=>/^mount$/i.test(entry.name));
    if (mounts.length!==1 || mounts[0].repeated || /^dummy$/i.test(mounts[0].value)) return;
    name=mounts[0].value.toLowerCase();
    if (!parts.has(name)) return;
  }
  if (!name) return;
  const matches = doc.sections.filter(section => section.name.toLowerCase() === name);
  if (matches.length !== 1) return;
  const target = matches[0];
  const sameKey = (entry: IniEntry) => entry.name.toLowerCase() === key.name.toLowerCase();
  if (target.keys.some(sameKey) || key.section.keys.filter(sameKey).length !== 1) return;
  const directive = doc.modifiers.findLast(mod => mod.line < target.line && /^(repeat|end)$/.test(mod.name));
  if (directive?.name === "repeat") return;

  const headerEnd = { line: target.line, character: doc.lines[target.line].length };
  const breakAfter = (i: number) => document.getText(Range.create(i, doc.lines[i].length, i + 1, 0));
  const eol = target.line + 1 < doc.lines.length ? breakAfter(target.line) : breakAfter(line);
  const removal = line + 1 < doc.lines.length ? Range.create(line, 0, line + 1, 0) :
    Range.create(line - 1, doc.lines[line - 1].length, line, doc.lines[line].length);
  const edits = [TextEdit.del(removal), TextEdit.insert(headerEnd, eol + doc.lines[line])];
  return {
    title: `Move ${key.name} to [${target.name}]`, kind: CodeActionKind.QuickFix, isPreferred: true,
    diagnostics: [diagnostic],
    edit: versionedEdits ? { documentChanges: [{ textDocument: { uri: document.uri, version: document.version }, edits }] }
      : { changes: { [document.uri]: edits } }
  };
}
