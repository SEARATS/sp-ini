import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { parse, sectionGroup } from "./ini";
import { children } from "./roots";
import { scalarType } from "./values";

const unitFolders = { aircraft: ["aircraft", "helicopter"], vessels: ["vessel", "submarine"], land_units: ["landunit"], biologic: ["biologic"] };
const excluded = new Set(["node_modules", "bin", "obj", "dist", "decompiled", "artifacts", "Library", "Packages"]);
const normalize = value => value.replaceAll("\\", "/").toLowerCase();
function uriKey(uri) {
  if (!uri.startsWith("file:")) return uri;
  const url = new URL(uri);
  const key = url.host + "/" + decodeURIComponent(url.pathname);
  return process.platform === "win32" ? key.toLowerCase() : key;
}
const unitFolder = rel => normalize(rel).split("/").at(-2);

function family(rel, doc) {
  const target = doc.modifiers.find(m => ["extend", "prepend", "copy", "alias"].includes(m.name))?.args.split(",")[0].trim();
  const parts = normalize(target || rel).split("/");
  const name = parts.pop();
  if (name === "_info.ini") return "mod metadata";
  if (doc.sections.some(s => s.name.toLowerCase() === "mission") || parts.includes("missions")) return "mission";
  if (name.endsWith("_variants.ini")) return "variants";
  if (name.endsWith("_squadrons.ini")) return "squadrons";
  const folder = parts.at(-1);
  if (Object.hasOwn(unitFolders, folder) || folder === "ammunition") return folder;
  const unitType = doc.sections.find(s => s.name.toLowerCase() === "general")?.keys.find(k => k.name.toLowerCase() === "unittype");
  if (unitType) {
    for (const [dir, types] of Object.entries(unitFolders)) {
      if (types.includes(unitType.value.toLowerCase())) return dir;
    }
  }
  return name;
}

function getOrCreate(map, key, make) {
  if (!map.has(key)) map.set(key, make());
  return map.get(key);
}

class Catalog {
  mirrorModels = new Map();
  mirrorTextures = new Map();
  modelParts = new Map();
  objOwners = new Map();
  sections = new Map();
  units = new Map();
  paths = new Map();
  assets = new Map();
  filesByUri = new Map();
  references = new Map();
  counts = new Map();
  skipped = 0;

  add(file, doc) {
    const group = family(file.rel, doc);
    const ref = (name, line, start = 0) => ({ name, line, start, file });
    const names = submodelNames(doc);
    const models = doc.entries.filter(e => /^(resourcesroot|rootmesh)$/i.test(e.name) && /\.obj$/i.test(e.value));
    for (const name of new Set(models.map(k => path.posix.basename(normalize(k.value))))) {
      getOrCreate(this.objOwners, name, () => []).push(file);
    }
    if (names.size) getOrCreate(this.modelParts, normalize(file.rel), () => []).push(
      ...doc.sections.filter(s => names.has(s.name.toLowerCase())).map(s => ref(s.name, s.line, s.start)));
    const addPath = rel => getOrCreate(this.paths, normalize(rel), () => []).push(ref(rel, 0));
    addPath(file.rel);
    this.filesByUri.set(uriKey(file.uri), file);
    const target = doc.modifiers.find(m => ["extend", "prepend"].includes(m.name));
    const targets = target ? target.args.split(",").map(s => normalize(s.trim())) : [normalize(file.rel)];
    const addRef = (domain, item) => {
      const names = getOrCreate(this.references, domain, () => new Map());
      getOrCreate(names, item.name.toLowerCase(), () => []).push(item);
    };
    for (const rel of targets) {
      const dir = unitFolder(rel), stem = path.posix.basename(rel, ".ini");
      if (["ammunition", "animations", "optical_views"].includes(dir) && !target) addRef(dir, ref(stem, 0));
      if (dir === "systems" || /_(variants|squadrons)$/.test(stem)) {
        const domain = dir === "systems" ? stem : dir + "/" + stem;
        for (const s of doc.sections) addRef(domain, ref(s.name, s.line, s.start));
      }
      if (stem === "nations_reference") for (const k of doc.entries) {
        if (k.name.toLowerCase() === "nationname") addRef("nations", ref(k.value, k.line, k.valueStart));
      }
    }
    const parent = unitFolder(file.rel);
    const filename = path.basename(file.rel);
    if (Object.hasOwn(unitFolders, parent) && !/_(?:variants|squadrons)\.ini$/i.test(filename) && filename.toLowerCase() !== "_info.ini" &&
        !doc.modifiers.some(m => ["extend", "prepend"].includes(m.name))) {
      const id = filename.slice(0, -4);
      const type = doc.sections.find(s => s.name.toLowerCase() === "general")?.keys.find(k => k.name.toLowerCase() === "unittype");
      const kind = type?.value.toLowerCase();
      const kinds = kind === "vtol" ? ["aircraft"] : kind ? [kind] : unitFolders[parent];
      getOrCreate(this.units, id.toLowerCase(), () => []).push({ ...ref(id, type?.line || 0), kinds });
    }
    for (const section of doc.sections) {
      const groups = getOrCreate(this.sections, sectionGroup(section.name), () => new Map());
      const schema = getOrCreate(groups, group, () => ({ ...ref(section.name, section.line, section.start), keys: new Map() }));
      for (const key of section.keys) {
        const item = getOrCreate(schema.keys, key.name.toLowerCase(), () => ({
          ...ref(key.name, key.line, key.start), example: key.value.slice(0, 100)
        }));
        if (file.source === "Vanilla" && item.stock?.type !== "text") {
          const type = scalarType(key.value);
          if (!item.stock) item.stock = { type, first: file, multiple: false };
          else {
            if (item.stock.type !== type) item.stock.type = "text";
            if (item.stock.first !== file) item.stock.multiple = true;
          }
        }
      }
    }
    this.counts.set(file.source, (this.counts.get(file.source) || 0) + 1);
  }

  schemas(name, group) {
    const groups = this.sections.get(sectionGroup(name));
    return groups?.has(group) ? [groups.get(group)] : [...(groups?.values() || [])];
  }
}

async function buildCatalog(roots) {
  const catalog = new Catalog(), seen = new Set();
  const files = [];
  async function walk(dir, base, source) {
    const childrenHere = await children(dir);
    if (childrenHere.some(e => e.name.toLowerCase() === "_info.ini") && source === "Workspace") base = dir;
    for (const entry of childrenHere.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".") && !excluded.has(entry.name)) await walk(full, base, source);
      else if (entry.isFile() && /\.(ini|png|jpe?g|tga|dds|obj|mtl|fbx|mat|wav|ogg|xml|json|txt)$/i.test(entry.name) && !seen.has(full)) {
        seen.add(full);
        const file = { full, rel: path.relative(base, full).replaceAll("\\", "/"), uri: pathToFileURL(full).href, source };
        if (entry.name.toLowerCase().endsWith(".ini")) files.push(file);
        else {
          catalog.filesByUri.set(uriKey(file.uri), file);
          getOrCreate(catalog.assets, normalize(file.rel), () => []).push({ file, name: file.rel, line: 0, start: 0 });
        }
      }
    }
  }
  for (const { dir, source } of roots) {
    await walk(dir, dir, source);
    if (source !== "Workspace") continue;
    const manifest = await fs.readFile(path.join(dir,"sp-ini-models.json"),"utf8").then(JSON.parse,()=>null);
    if (!manifest) continue;
    for (const [rel,name] of Object.entries(manifest.models || {})) {
      const refs = catalog.assets.get(normalize(rel));
      if (refs && typeof name === "string") getOrCreate(catalog.mirrorModels,normalize(name),()=>[]).push(...refs);
    }
    for (const [guid,rel] of Object.entries(manifest.textures || {})) {
      if (typeof rel === "string") catalog.mirrorTextures.set(guid,catalog.assets.get(normalize(rel))?.[0]?.file);
    }
  }
  for (let pos = 0; pos < files.length; pos += 24) {
    const batch = files.slice(pos, pos + 24);
    const texts = await Promise.all(batch.map(file => fs.readFile(file.full, "utf8").catch(() => null)));
    texts.forEach((text, i) => {
      if (text === null) catalog.skipped++;
      else catalog.add(batch[i], parse(text));
    });
  }
  return catalog;
}

function submodelNames(doc) {
  const list = doc.sections.find(s => /^submodels$/i.test(s.name));
  const entries = list?.keys ?? doc.sections.find(s => /^models$/i.test(s.name))?.keys.filter(k => /^submodel\d+$/i.test(k.name));
  return new Set((entries || []).map(k => k.value.toLowerCase()));
}

export { Catalog, buildCatalog, family, normalize, submodelNames, uriKey };
