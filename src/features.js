const { CompletionItemKind, DiagnosticSeverity, Range, SymbolKind } = require("vscode-languageserver/node");
const { family, normalize } = require("./catalog");
const { directives, unitSection } = require("./ini");

const span = (line, start, end) => Range.create(line, start, line, end);
const location = ref => ({ uri: ref.file.uri, range: span(ref.line, ref.start, ref.start + ref.name.length) });
const source = ref => ref.file.source + " · " + ref.file.rel;
const asSection = (section, uri) => ({ ...section, file: { uri, source: "Document", rel: section.name } });

function inspect(doc, uri, pos, catalog) {
  const raw = doc.lines[pos.line] || "";
  const before = raw.slice(0, pos.character);
  const section = doc.sections.findLast(s => s.line <= pos.line);
  const group = family(uri, doc);
  const directive = /^\s*#!(\w*)/.exec(raw);
  const result = (kind, start, end, items, suffix = "") => ({ kind, start, end, items, suffix, raw });
  if (directive && before.trimStart().startsWith("#!")) {
    const end = directive[0].length;
    if (pos.character <= end) return result(CompletionItemKind.Keyword, raw.indexOf("#!"), end,
      Object.entries(directives).map(([name, detail]) => ({ name: "#!" + name, detail })));
    if (!["extend", "prepend", "copy", "alias"].includes(directive[1])) return;
    const from = Math.max(end, raw.lastIndexOf(",", pos.character - 1) + 1);
    const next = raw.indexOf(",", pos.character);
    const start = from + (raw.slice(from, pos.character).match(/^\s*/)[0].length);
    return result(CompletionItemKind.File, start, next < 0 ? raw.trimEnd().length : next, [...catalog.paths.values()].flat());
  }
  if (/(?:;|#|(?<!:)\/\/)/.test(before)) return;
  if (before.trimStart().startsWith("[")) {
    let schemas = [...catalog.sections.values()].map(groups => groups.get(group)).filter(Boolean);
    if (!schemas.length) schemas = [...catalog.sections.values()].map(groups => groups.values().next().value);
    return result(CompletionItemKind.Module, raw.indexOf("[") + 1, raw.indexOf("]") < 0 ? raw.trimEnd().length : raw.indexOf("]"),
      schemas, raw.includes("]") ? "" : "]");
  }
  if (!section) return;
  const equals = raw.indexOf("=");
  if (equals < 0 || pos.character <= equals) {
    const schemas = catalog.schemas(section.name, group);
    const keys = schemas.flatMap(s => [...s.keys.values()]);
    return result(CompletionItemKind.Property, raw.match(/^\s*/)[0].length, (equals < 0 ? raw : raw.slice(0, equals)).trimEnd().length,
      keys, equals < 0 ? "=" : "");
  }
  const key = raw.slice(0, equals).trim().toLowerCase();
  const kind = unitSection.exec(section.name)?.[1].toLowerCase();
  const start = equals + 1 + before.slice(equals + 1).match(/^\s*/)[0].length;
  const end = equals + 1 + raw.slice(equals + 1).split(/;|#|(?<!:)\/\//, 1)[0].trimEnd().length;
  if (key === "type" && kind) {
    const units = [...catalog.units.values()].flatMap(refs => refs.filter(ref => ref.kinds.includes(kind)));
    return result(CompletionItemKind.Reference, start, end, units);
  }
  if (key === "homebase" && kind) return result(CompletionItemKind.Reference, start, end,
    doc.sections.filter(s => unitSection.test(s.name)).map(s => asSection(s, uri)));
}

function completions(context, pos) {
  if (!context) return [];
  const { raw, start, end, items, kind, suffix } = context;
  const typed = normalize(raw.slice(start, pos.character));
  const seen = new Set(), matches = [];
  for (const ref of items) {
    const name = normalize(ref.name);
    if (!name.startsWith(typed) || seen.has(name)) continue;
    seen.add(name);
    matches.push({ label: ref.name, kind, detail: ref.detail || source(ref),
      textEdit: { range: span(pos.line, start, Math.max(start, end)), newText: ref.name + suffix } });
    if (matches.length === 250) return { isIncomplete: true, items: matches };
  }
  return matches;
}

function exact(context) {
  if (!context) return [];
  const token = normalize(context.raw.slice(context.start, context.end).trim());
  return context.items.filter(ref => normalize(ref.name) === token);
}

function diagnostics(doc, catalog) {
  const result = doc.issues.map(({ line, message }) => ({
    range: span(line, 0, doc.lines[line].length), severity: DiagnosticSeverity.Warning, source: "Sea Power INI", message
  }));
  if (!catalog?.units.size) return result;
  for (const key of doc.entries) {
    if (key.name.toLowerCase() !== "type" || !unitSection.test(key.section?.name || "") ||
        !/^[\w.-]+$/.test(key.value) || catalog.units.has(key.value.toLowerCase())) continue;
    const start = doc.lines[key.line].indexOf(key.value, doc.lines[key.line].indexOf("=") + 1);
    result.push({ range: span(key.line, start, start + key.value.length), severity: DiagnosticSeverity.Information,
      source: "Sea Power INI", message: "Unit ID '" + key.value + "' was not found in the indexed content folders." });
  }
  return result;
}

function symbols(doc) {
  return doc.sections.map((section, i) => {
    const { name, line, start } = section;
    const last = (doc.sections[i + 1]?.line ?? doc.lines.length) - 1;
    return { name, kind: SymbolKind.Namespace, selectionRange: span(line, start, start + name.length),
      range: Range.create(line, 0, last, doc.lines[last].length), children: section.keys.map(key => ({
        name: key.name, kind: SymbolKind.Property, range: span(key.line, key.start, doc.lines[key.line].length),
        selectionRange: span(key.line, key.start, key.start + key.name.length)
      })) };
  });
}

module.exports = { completions, diagnostics, exact, inspect, location, source, symbols };
