const path = require("node:path").posix;
const { unitSection } = require("./ini");
const { normalize, uriKey } = require("./catalog");

const explicitFile = /\.(?:ini|png|jpe?g|tga|dds|obj|mtl|fbx|wav|ogg|xml|json|txt)$/i;
const unitDirs = { aircraft: "aircraft", helicopter: "aircraft", vessel: "vessels", submarine: "vessels", landunit: "land_units", biologic: "biologic" };

function tokens(value, offset) {
  return [...value.matchAll(/[^,|]+/g)].map(match => {
    const name = match[0].trim();
    const start = offset + match.index + match[0].indexOf(name);
    return { name, start, end: start + name.length };
  }).filter(t => t.name);
}

function referenceContext(doc, uri, catalog) {
  const current = catalog.filesByUri.get(uriKey(uri));
  const folder = path.dirname(current?.rel || ".");
  const resources = doc.sections.find(s => /^models$/i.test(s.name))?.keys.find(k => /^resourcesfolder$/i.test(k.name))?.value;
  const locals = new Map();
  for (const s of doc.sections) {
    const name = s.name.toLowerCase();
    if (!locals.has(name)) locals.set(name, []);
    locals.get(name).push({ name: s.name, start: s.start, line: s.line, file: { uri, source: "Document", rel: s.name } });
  }
  return { catalog, folder, resources, locals, inherited: doc.modifiers.some(m => /^(alias|extend|prepend|copy)$/.test(m.name)) };
}

function domainFor(section, key) {
  const name = section?.name || "";
  if (/^nation$/i.test(key)) return "nations";
  if (/^systemname$/i.test(key)) {
    if (/^sensorsystem\d+$/i.test(name)) return "sensors";
    if (/^weaponsystem\d+$/i.test(name)) return "weapons";
    if (/^combatsystem\d+$/i.test(name)) return "combatsystems";
  }
  if (/^ammunition\d*$/i.test(key)) return "ammunition";
  if (/^animationfile_?\d+$/i.test(key)) return "animations";
  if (/^opticalview$/i.test(name) && /^(views|default)$/i.test(key)) return "optical_views";
  const unit = unitSection.exec(name);
  if (unit && /^(variantreference|squadronreference)$/i.test(key)) {
    const id = section.keys.find(k => /^type$/i.test(k.name))?.value.toLowerCase();
    if (id) return unitDirs[unit[1].toLowerCase()] + "/" + id + (/^variant/i.test(key) ? "_variants" : "_squadrons");
  }
}

function reference(entry, token, ctx) {
  const key = entry.name, value = normalize(token);
  const unit = unitSection.exec(entry.section?.name || "");
  if (unit && /^type$/i.test(key)) return { refs: (ctx.catalog.units.get(value) || []).filter(ref => ref.kinds.includes(unit[1].toLowerCase())) };
  if (explicitFile.test(value)) {
    const candidates = [path.join(ctx.folder, value), path.normalize(value)];
    if (ctx.resources) candidates.unshift(path.join(normalize(ctx.resources), value));
    for (const candidate of new Set(candidates)) {
      const refs = ctx.catalog.paths.get(candidate) || ctx.catalog.assets.get(candidate);
      if (refs) return { refs };
    }
    const expectsPath = /file|path|material|texture|resourcesroot|image|^base$/i.test(key) || /^textures$/i.test(entry.section?.name);
    return { refs: [], missing: expectsPath && ctx.catalog.paths.size && "File was not found in the indexed content folders." };
  }
  const domain = domainFor(entry.section, key);
  if (domain) {
    const names = ctx.catalog.references.get(domain);
    return { refs: names?.get(value) || [], missing: names?.size && !/^(random|default|none|dummy)$/i.test(value)
      && "No indexed " + domain + " definition for '" + token + "'." };
  }
  const refs = ctx.locals.get(value) || [];
  const local = /^(associatedsensors|associatedmagazine|homebase)$/i.test(key) ||
    (/^submodels$/i.test(entry.section?.name) && /^submodel\d+$/i.test(key));
  return { refs: local || !/^(type|systemname)$/i.test(key) ? refs : [],
    missing: local && !ctx.inherited && !/^(none|default|dummy)$/i.test(value) && "No section named [" + token + "] in this file." };
}

module.exports = { tokens, referenceContext, reference, domainFor, explicitFile };
