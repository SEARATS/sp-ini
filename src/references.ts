import { posix as path } from "node:path";
import { unitSection } from "./ini";
import { normalize, submodelNames, uriKey } from "./catalog";

const explicitFile = /\.(?:ini|png|jpe?g|tga|dds|obj|mtl|fbx|prefab|mat|wav|ogg|xml|json|txt)$/i;
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
  const folder = normalize(path.dirname(current?.rel || "."));
  const resources = doc.sections.find(s => /^models$/i.test(s.name))?.keys.find(k => /^resourcesfolder$/i.test(k.name))?.value;
  const meshColliders = meshColliderSections(doc);
  const locals = new Map();
  for (const s of doc.sections) {
    const name = s.name.toLowerCase();
    if (!locals.has(name)) locals.set(name, []);
    locals.get(name).push({ name: s.name, start: s.start, line: s.line, file: { uri, source: "Document", rel: s.name } });
  }
  const bases = doc.modifiers.filter(m => /^(alias|extend|prepend|copy)$/.test(m.name));
  const inheritedParts = bases.flatMap(m => tokens(m.args, 0).flatMap(t => catalog.modelParts.get(normalize(t.name)) || []));
  const rootMesh = doc.sections.find(s => /^models$/i.test(s.name))?.keys.find(k => /^resourcesmesh$/i.test(k.name));
  return { catalog, folder, resources, locals, meshColliders, parts: submodelNames(doc), rootMesh, uri, inheritedParts, inherited: !!bases.length };
}

function meshColliderSections(doc) {
  const colliders = doc.sections.find(s => /^colliders$/i.test(s.name));
  return new Set(colliders?.keys.filter(k => /^meshcollider\d+$/i.test(k.name)).map(k => k.value.toLowerCase()));
}

function isMesh(entry, meshColliders) {
  return /^(mesh|resourcesmesh)$/i.test(entry.name) ||
    (/^collider$/i.test(entry.name) && meshColliders.has(entry.section?.name.toLowerCase()));
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
  if (isMesh(entry, ctx.meshColliders) && !/\.(obj|fbx)$/i.test(value)) return { refs: [] };
  if (/^(containerbase|containerbaseparent|gun\d+)$/i.test(key)) {
    if (/^containerbase$/i.test(key) && /^(dummy|mount)$/i.test(token)) return { refs: [] };
    let refs = ctx.parts.has(value) ? ctx.locals.get(value) || [] : [];
    if (!refs.length && ctx.rootMesh?.value.toLowerCase() === value) {
      refs = [{ name: token, line: ctx.rootMesh.line, start: ctx.rootMesh.valueStart, file: { uri: ctx.uri, source: "Document", rel: "Models" } }];
    }
    if (!refs.length) refs = ctx.inheritedParts.filter(r => r.name.toLowerCase() === value);
    return { refs, missing: !ctx.inherited && "No model part named '" + token + "' is declared for this unit." };
  }
  if (/^collider$/i.test(key) && /^(box|sphere)$/i.test(token)) return { refs: [] };
  const unit = unitSection.exec(entry.section?.name || "");
  if (unit && /^type$/i.test(key)) return { refs: (ctx.catalog.units.get(value) || []).filter(ref => ref.kinds.includes(unit[1].toLowerCase())) };
  const modelRoot = /^(resourcesroot|rootmesh)$/i.test(key);
  if (modelRoot && entry.value?.split(",").slice(1).some(flag=>flag.trim()===token)) return {refs:[]};
  const material = /^(resourcesmaterial|material)$/i.test(key);
  const texture = /^textures$/i.test(entry.section?.name || "");
  const folderKey = material ? "resourcesmaterialfolder" : modelRoot ? "resourcesmeshfolder" : "";
  const folder = entry.section?.keys.find(k=>k.name.toLowerCase() === folderKey)?.value || ctx.resources;
  if (explicitFile.test(value)) {
    const candidates = [path.join(ctx.folder, value), path.normalize(value)];
    if (folder) candidates.unshift(path.join(normalize(folder), value));
    const refs = ctx.catalog.ordered(candidates.flatMap(candidate=>ctx.catalog.paths.get(candidate) || ctx.catalog.assets.get(candidate) || []));
    if (refs.length) return { refs };
    const expectsPath = /file|path|material|texture|resourcesroot|image|^base$|mesh$/i.test(key) || /^textures$/i.test(entry.section?.name);
    return { refs: [], missing: expectsPath && ctx.catalog.paths.size && "File was not found in the indexed content folders." };
  }
  if (modelRoot || material || texture) {
    const extensions = modelRoot ? [".obj",".fbx",".prefab"] : material ? [".ini",".mat"] : [".png",".jpg",".jpeg",".tga",".dds"];
    const refs = extensions.flatMap(ext=>{
      const candidate = path.join(normalize(folder || ""),value+ext);
      return ctx.catalog.assets.get(candidate) || ctx.catalog.paths.get(candidate) || [];
    });
    if (modelRoot) refs.push(...ctx.catalog.mirrorModels.get(value) || []);
    if (refs.length) return {refs:ctx.catalog.ordered(refs)};
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

export { tokens, referenceContext, reference, domainFor, explicitFile, isMesh, meshColliderSections };
