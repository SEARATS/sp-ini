const { CompletionItemKind, DiagnosticSeverity, Range, SymbolKind } = require("vscode-languageserver/node");
const { family, normalize } = require("./catalog");
const { directives, sectionGroup, unitSection } = require("./ini");
const { choices, expected, validValue, valueRule } = require("./values");
const { tokens, referenceContext, domainFor, reference } = require("./references");

const span = (line, start, end) => Range.create(line, start, line, end);
const location = ref => ({ uri: ref.file.uri, range: span(ref.line, ref.start, ref.start + ref.name.length) });
const source = ref => ref.file.source + " · " + ref.file.rel;
const asSection = (section, uri) => ({ ...section, file: { uri, source: "Document", rel: section.name } });
function closeSpelling(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length < b.length) return a.slice(i) === b.slice(i + 1);
  if (a.length > b.length) return a.slice(i + 1) === b.slice(i);
  return a.slice(i + 1) === b.slice(i + 1) ||
    (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
}

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
  const rule = valueRule(group, section.name, key, catalog);
  const options = rule && choices(rule.type);
  if (options?.length) return result(CompletionItemKind.EnumMember, start, end,
    options.map(name => ({ name, detail: section.name + "." + raw.slice(0, equals).trim() })));
  if (key === "type" && kind) {
    const units = [...catalog.units.values()].flatMap(refs => refs.filter(ref => ref.kinds.includes(kind)));
    return result(CompletionItemKind.Reference, start, end, units);
  }
  if (key === "homebase" && kind) return result(CompletionItemKind.Reference, start, end,
    doc.sections.filter(s => unitSection.test(s.name)).map(s => asSection(s, uri)));
  const entry = doc.entries.find(e => e.line === pos.line);
  if (!entry) return;
  const token = tokens(entry.value, entry.valueStart).find(t => t.start <= pos.character && pos.character <= t.end);
  const domain = domainFor(section, key);
  const known = catalog.references.get(domain);
  if (known) return result(CompletionItemKind.Reference, token?.start ?? pos.character, token?.end ?? pos.character,
    [...known.values()].flat());
  if (token) {
    const refs = reference(entry, token.name, referenceContext(doc, uri, catalog)).refs;
    return result(CompletionItemKind.Reference, token.start, token.end, refs.map(ref => ({ ...ref, name: token.name })));
  }
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

function diagnostics(doc, catalog, uri = "") {
  const result = doc.issues.map(({ line, message }) => ({
    range: span(line, 0, doc.lines[line].length), severity: DiagnosticSeverity.Warning, source: "Sea Power INI", message
  }));
  const group = family(uri, doc);
  const ctx = catalog && referenceContext(doc, uri, catalog);
  for (const section of doc.sections) {
    const seen = new Map();
    const schema = catalog?.sections.get(sectionGroup(section.name))?.get(group);
    for (const key of section.keys) {
      if (key.repeated || key.name.includes("{")) continue;
      const name = key.name.toLowerCase();
      let message, severity = DiagnosticSeverity.Warning;
      if (seen.has(name)) message = key.name + " already appears on line " + (seen.get(name) + 1) + " of this section.";
      else if (schema && /^[a-z]{5,}$/.test(name) && !schema.keys.get(name)?.stock) {
        const similar = [...schema.keys.values()].filter(k => k.stock && closeSpelling(name, k.name.toLowerCase()));
        if (similar.length === 1) {
          message = "Similar vanilla key in [" + section.name + "]: " + similar[0].name + ".";
          severity = DiagnosticSeverity.Hint;
        }
      }
      if (message) result.push({ range: span(key.line, key.start, key.start + key.name.length), severity, source: "Sea Power INI", message });
      if (!seen.has(name)) seen.set(name, key.line);
    }
  }
  for (const key of doc.entries) {
    if (/[{}]/.test(key.value)) continue;
    const report = (severity, message, start = key.valueStart, end = start + key.value.length) =>
      result.push({ range: span(key.line, start, end), severity, source: "Sea Power INI", message });
    const rule = valueRule(group, key.section?.name, key.name, catalog);
    if (rule && !validValue(rule.type, key.value)) {
      const message = rule.inferred ? "Vanilla examples use " + expected(rule.type) + " for " + key.name + "."
        : "Invalid " + key.name + " '" + key.value + "'. Expected " + expected(rule.type) + ".";
      report(rule.inferred ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error, message);
    }
    const kind = unitSection.exec(key.section?.name || "")?.[1].toLowerCase();
    if (kind && /^type$/i.test(key.name) && catalog?.units.size && /^[\w.-]+$/.test(key.value)) {
      const units = catalog.units.get(key.value.toLowerCase());
      if (!units) report(DiagnosticSeverity.Information, "Unit ID '" + key.value + "' was not found in the indexed content folders.");
      else if (!units.some(u => u.kinds.includes(kind))) report(DiagnosticSeverity.Warning, "Unit '" + key.value + "' is not indexed as " + kind + ".");
    }
    if (!ctx) continue;
    for (const token of tokens(key.value, key.valueStart)) {
      const { refs, missing } = reference(key, token.name, ctx);
      if (missing && !refs.length) report(DiagnosticSeverity.Information, missing, token.start, token.end);
    }
  }
  for (const mod of doc.modifiers) {
    if (!/^(extend|prepend|copy|alias)$/.test(mod.name) || !catalog?.paths.size) continue;
    for (const token of tokens(mod.args, mod.argsStart)) {
      if (!catalog.paths.has(normalize(token.name))) result.push({ range: span(mod.line, token.start, token.end),
        severity: DiagnosticSeverity.Information, source: "Sea Power INI", message: "Directive target was not found in the indexed content folders." });
    }
  }
  return result;
}

function documentLinks(doc, uri, catalog) {
  const ctx = referenceContext(doc, uri, catalog), links = [];
  for (const mod of doc.modifiers) {
    if (!/^(extend|prepend|alias|copy)$/.test(mod.name)) continue;
    for (const token of tokens(mod.args, mod.argsStart)) {
      const refs = catalog.paths.get(normalize(token.name));
      if (refs?.length === 1) links.push({ range: span(mod.line, token.start, token.end), target: refs[0].file.uri });
    }
  }
  for (const entry of doc.entries) {
    for (const token of tokens(entry.value, entry.valueStart)) {
      const refs = reference(entry, token.name, ctx).refs;
      if (refs.length !== 1) continue;
      const ref = refs[0];
      links.push({ range: span(entry.line, token.start, token.end), target: ref.file.uri + (ref.line ? "#L" + (ref.line + 1) : "") });
    }
  }
  return links;
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

module.exports = { completions, diagnostics, documentLinks, exact, inspect, location, source, symbols };
