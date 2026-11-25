import { CodeActionKind, Range, TextEdit, type CodeAction, type Diagnostic } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { IniEntry, parse } from "./ini";
import { ignoredRules } from "./ini-edits";
import { submodelNames } from "./catalog";

type Ini = ReturnType<typeof parse>;
export const placementCode = "ignored-section-key";

// ObjectBaseLoader.LoadSubmodel reads these settings. SensorSystem.LoadSensorSystemData
// resolves Mount to an existing object and does not assign its visual material.
export function ignoredSensorKey(key: IniEntry, parts: Set<string>) {
  return /^SensorSystem\d+$/i.test(key.section?.name ?? "") && !parts.has(key.section.name.toLowerCase()) &&
    /^(Material|ResourcesMaterialFolder|MaterialTexture(?:Diffuse|Specular|Normal))$/i.test(key.name);
}

export function moveToMount(document: TextDocument, doc: Ini, diagnostic: Diagnostic, versionedEdits: boolean): CodeAction | undefined {
  if (diagnostic.source !== "Sea Power INI" || diagnostic.code !== placementCode) return;
  const { line, character } = diagnostic.range.start;
  const key = doc.entries.find(entry => entry.line === line && entry.start === character);
  const parts = submodelNames(doc);
  if (!key || key.repeated || !ignoredSensorKey(key, parts) || ignoredRules(doc.lines[line]).includes(placementCode)) return;

  const mounts = key.section.keys.filter(entry => /^mount$/i.test(entry.name));
  if (mounts.length !== 1 || mounts[0].repeated || /^dummy$/i.test(mounts[0].value)) return;
  if (doc.sections.some(section => section !== key.section && section.name.toLowerCase() === key.section.name.toLowerCase())) return;
  const name = mounts[0].value.toLowerCase();
  if (!parts.has(name)) return;
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
