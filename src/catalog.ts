import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { parse, sectionGroup } from "./ini";
import { children, type ContentRoot } from "./roots";
import { scalarType } from "./values";
import { MaterialFolders } from "./material-folders";

const unitFolders = { aircraft: ["aircraft", "helicopter"], vessels: ["vessel", "submarine"], land_units: ["landunit"], biologic: ["biologic"] };
const excluded = new Set(["node_modules", "bin", "obj", "dist", "decompiled", "artifacts", "Library", "Packages"]);
const normalize = value => value.replaceAll("\\", "/").toLowerCase();
function within(root: string, full: string) {
  const rel = path.relative(root,full);
  return rel !== ".." && !rel.startsWith(".."+path.sep) && !path.isAbsolute(rel);
}
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
  readonly materialFolders = new MaterialFolders();
  sourceRanks = new Map<string,number>();
  rank(source?: string) { return this.sourceRanks.get(source) ?? Number.MAX_SAFE_INTEGER; }
  preferred(refs) {
    if (refs.length < 2) return refs;
    const first = refs.reduce((best,ref)=>Math.min(best,this.rank(ref.file?.source)),Infinity);
    return refs.filter(ref=>this.rank(ref.file?.source) === first);
  }
  ordered(refs) {
    const seen = new Set();
    return refs.filter(r => !seen.has(r.file.uri) && seen.add(r.file.uri)).sort((a,b)=>this.rank(a.file.source)-this.rank(b.file.source));
  }
  async withPacked<T>(file: {source:string} | undefined, loose: () => Promise<T>, packed: () => Promise<T>): Promise<T> {
    if (!file) return packed();
    return this.rank("Vanilla") < this.rank(file.source) ? await packed() ?? loose() : await loose() ?? packed();
  }
  mirrorModels = new Map();
  mirrorMeshes = new Map();
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
      if (stem === "nations" || stem === "layout") for (const k of doc.entries) {
        if (/^nations$/i.test(k.section?.name || "")) addRef("nations", ref(k.name, k.line, k.start));
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

async function buildCatalog(roots: ContentRoot[]) {
  const catalog = new Catalog(), seen = new Set();
  const originRanks = new Map([...new Set(roots.map(r=>r.origin || r.source))].map((origin,i)=>[origin,i]));
  const resourceRoots = roots.filter(r=>r.source === "Resources");
  const useResources = (await Promise.all(resourceRoots.map(r=>fs.stat(r.dir).then(s=>s.isDirectory(),()=>false)))).some(Boolean);
  const files = [], textureMeta = [];
  const manifestGuids = new Map<string,string>();
  const manifests = new Map();
  for (const {dir,source} of roots) {
    if (source !== "Unity mirror" && source !== "Workspace" || manifests.has(dir)) continue;
    manifests.set(dir,await fs.readFile(path.join(dir,"sp-ini-models.json"),"utf8").then(JSON.parse).catch(()=>null));
  }
  for (const {dir,source} of roots) {
    if (source !== "Unity mirror") continue;
    for (const [guid,rel] of Object.entries(manifests.get(dir)?.textures || {})) {
      if (typeof rel === "string" && rel.startsWith("Assets/") && !rel.split(/[\\/]/).includes(".."))
        manifestGuids.set(path.join(dir,rel),guid);
    }
  }
  async function walk(dir, base, source, omit: string[] = []) {
    if (omit.some(root => within(root,dir))) return;
    const childrenHere = await children(dir);
    const meta = source === "Resources" ? new Set(childrenHere.map(e=>e.name)) : undefined;
    if ((source === "Workspace" || source === "Data") && childrenHere.some(e => e.name.toLowerCase() === "_info.ini")) base = dir;
    if (dir !== base && (!useResources || source === "Resources"))
      catalog.materialFolders.add(path.relative(base,dir),source,catalog.rank(source));
    for (const entry of childrenHere.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".") && !excluded.has(entry.name)) await walk(full, base, source, omit);
      else if (entry.isFile() && /\.(ini|png|jpe?g|tga|dds|obj|mtl|fbx|prefab|mat|wav|ogg|xml|json|txt)$/i.test(entry.name) && !seen.has(full)) {
        seen.add(full);
        const file = { full, rel: path.relative(base, full).replaceAll("\\", "/"), uri: pathToFileURL(full).href, source };
        if (entry.name.toLowerCase().endsWith(".ini")) files.push(file);
        else {
          catalog.filesByUri.set(uriKey(file.uri), file);
          getOrCreate(catalog.assets, normalize(file.rel), () => []).push({ file, name: file.rel, line: 0, start: 0 });
          if (source === "Resources" && /\.(png|jpe?g)$/i.test(entry.name)) {
            const guid = manifestGuids.get(full);
            if (guid && !catalog.mirrorTextures.has(guid)) catalog.mirrorTextures.set(guid,file);
            else if (meta.has(entry.name+".meta")) textureMeta.push(file);
          }
        }
      }
    }
  }
  for (const { dir, source, origin, omit = [] } of roots) {
    catalog.sourceRanks.set(source,originRanks.get(origin || source));
    const mirrorOnly = source === "Unity mirror";
    const manifest = manifests.get(dir);
    if (mirrorOnly && !manifest) continue;
    if (source === "Workspace" && Array.isArray(manifest?.materials)) {
      await walk(dir,dir,source,[...omit,path.join(dir,"Assets")]);
    } else if (mirrorOnly && Array.isArray(manifest?.materials)) {
      // Generated Unity projects contain thousands of prefab, shader and metadata files.
      // The manifest already names the loose assets that an INI can reference.
      for (const rel of new Set([...Object.keys(manifest.models || {}), ...Object.keys(manifest.standalone || {}),
          ...Object.values(manifest.textures || {}), ...manifest.materials])) {
        if (typeof rel !== "string" || !rel.startsWith("Assets/") || rel.split(/[\\/]/).includes("..") || rel.includes("\\")) continue;
        const full = path.join(dir,rel), file = {full,rel,uri:pathToFileURL(full).href,source};
        if (omit.some(root => within(root,full))) continue;
        catalog.filesByUri.set(uriKey(file.uri),file);
        getOrCreate(catalog.assets, normalize(rel), ()=>[]).push({file,name:rel,line:0,start:0});
      }
    } else if (source === "Data") {
      const entries = await children(dir);
      const original = entries.find(e => e.isDirectory() && e.name.toLowerCase() === "original");
      if (original) {
        const stockDir = path.join(dir,original.name);
        const stockFolders = new Set((await children(stockDir)).filter(e=>e.isDirectory()).map(e=>e.name.toLowerCase()));
        const packs = entries.filter(e=>e.isDirectory() && !e.name.startsWith(".") && !stockFolders.has(e.name.toLowerCase()))
          .map(e=>path.join(dir,e.name)).filter(p=>p!==stockDir).sort();
        await walk(dir,dir,source,[stockDir,...packs]);
        for (const pack of packs) await walk(pack,pack,source);
        await walk(stockDir,stockDir,source);
      } else await walk(dir,dir,source);
    } else if (!mirrorOnly) {
      await walk(dir, dir, source, omit);
    }
    if (!mirrorOnly) continue;
    for (const [rel,name] of Object.entries(manifest.models || {})) {
      const refs = catalog.assets.get(normalize(rel))?.filter(r=>r.file.full===path.join(dir,rel));
      if (refs && typeof name === "string") getOrCreate(catalog.mirrorModels,normalize(name),()=>[]).push(...refs);
    }
    for (const [rel,mesh] of Object.entries<{name:string}>(manifest.standalone || {})) {
      const refs = catalog.assets.get(normalize(rel))?.filter(r=>r.file.full===path.join(dir,rel));
      if (refs && typeof mesh?.name==="string") getOrCreate(catalog.mirrorMeshes,normalize(mesh.name),()=>[]).push(...refs);
    }
    for (const [guid,rel] of Object.entries(manifest.textures || {})) {
      if (typeof rel === "string" && rel.startsWith("Assets/") && !rel.split(/[\\/]/).includes("..")) {
        const full = path.resolve(dir,rel);
        const file = catalog.filesByUri.get(uriKey(pathToFileURL(full).href));
        if (file && !catalog.mirrorTextures.has(guid)) catalog.mirrorTextures.set(guid,file);
      }
    }
  }
  for (let pos = 0; pos < textureMeta.length; pos += 32) {
    const batch = textureMeta.slice(pos,pos+32);
    const metas = await Promise.all(batch.map(file=>fs.readFile(file.full+".meta","utf8").catch(()=>"")));
    metas.forEach((text,i)=>{
      const guid = /^guid:\s*([\da-f]+)\s*$/im.exec(text)?.[1];
      if (guid && !catalog.mirrorTextures.has(guid)) catalog.mirrorTextures.set(guid,batch[i]);
    });
  }
  for (let pos = 0; pos < files.length; pos += 24) {
    const batch = files.slice(pos, pos + 24);
    const texts = await Promise.all(batch.map(file => fs.readFile(file.full, "utf8").catch(() => null)));
    texts.forEach((text, i) => {
      if (text === null) catalog.skipped++;
      else {
        const doc = parse(text), file = batch[i];
        catalog.add(file,doc);
        if (!useResources) for (const entry of doc.entries) {
          if (/^resourcesmaterialfolder$/i.test(entry.name)) catalog.materialFolders.add(entry.value,file.source,catalog.rank(file.source));
        }
      }
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
