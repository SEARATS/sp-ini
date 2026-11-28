import { posix as path } from "node:path";
import { Catalog, normalize, uriKey } from "./catalog";
import { Materials } from "./materials";
import { IniSection, unitSection } from "./ini";
import { field, expandEntityIni } from "./entity-model";

export interface Choice { id: string; label: string }
export interface Appearance { general?: IniSection; defaults?: IniSection; selected?: IniSection }
export interface PreviewRequest {uri: string; text: string; entity?: string; appearance?: string; render?: boolean; modelSources?: Record<string,string>; card?: boolean; locale?: string}

export async function readEntityDefinition(file:{uri:string}, catalog:Catalog, materials:Materials) {
  const doc = await materials.readIni(file);
  if (!doc?.modifiers.some(m=>/^(copy|alias|extend|prepend)$/.test(m.name))) return doc;
  return entityDocument(doc.lines.join("\n"),file.uri,catalog,materials).catch(()=>doc);
}

export async function entityDocument(text: string, uri: string, catalog: Catalog, materials: Materials, ancestors = new Set<string>(), copySources?: string[]) {
  const doc = expandEntityIni(text, uri);
  const base = doc.modifiers.find(m => /^(alias|copy|extend|prepend)$/.test(m.name));
  if (!base) return doc;
  const key = normalize(base.args.trim());
  const refs = catalog.paths.get(key) || catalog.paths.get(normalize(path.join(path.dirname(catalog.filesByUri.get(uriKey(uri))?.rel || ""),key)));
  const file = refs?.find(r => uriKey(r.file.uri) !== uriKey(uri))?.file;
  if (!file || ancestors.has(uriKey(file.uri))) throw Error("Cannot resolve entity base " + base.args);
  const source = await materials.readIni(file);
  if (!source) throw Error("Cannot read entity base " + base.args);
  if (base.name==="copy" || base.name==="alias") copySources?.push(path.basename(normalize(file.rel),".ini"));
  const inherited = await entityDocument(source.lines.join("\n"),file.uri,catalog,materials,new Set([...ancestors,uriKey(uri)]),copySources);
  const sections = new Map<string,IniSection>();
  const ordered = base.name === "prepend" ? [...doc.sections,...inherited.sections] : [...inherited.sections,...doc.sections];
  for (const s of ordered) {
    const prior = sections.get(s.name.toLowerCase());
    const overridden = new Set(s.keys.map(k => k.name.toLowerCase()));
    const merged = {...s, keys: [...s.keys,...(prior?.keys || []).filter(k => !overridden.has(k.name.toLowerCase()))]};
    merged.keys = merged.keys.map(k => ({...k,section:merged}));
    sections.set(s.name.toLowerCase(),merged);
  }
  return {...doc,sections:[...sections.values()]};
}

export async function selectEntity(request: PreviewRequest, catalog: Catalog, materials: Materials) {
  const {uri,text} = request, doc = expandEntityIni(text);
  const patch = doc.modifiers.find(m => /^(extend|prepend)$/.test(m.name));
  const filename = path.basename(patch?.args.trim() || decodeURIComponent(new URL(uri).pathname));
  const companion = /_(variants|squadrons)\.ini$/i.exec(filename);
  const baseName = filename.replace(/(?:_(?:variants|squadrons))?\.ini$/i,"");
  const entries = doc.sections.filter(s => unitSection.test(s.name));
  const entities: Choice[] = entries.length ? entries.map(s => ({id:s.name,label:s.name+" · "+(field(s,"type")?.value || "missing Type")})) : [{id:baseName,label:baseName}];
  const entity = entities.find(e=>e.id === request.entity) || entities[0];
  const declaration = entries.find(s=>s.name === entity.id);
  const kind = declaration && unitSection.exec(declaration.name)[1].toLowerCase();
  const unit = field(declaration,"type")?.value || baseName;
  function sibling(fileUri: string, name: string) {
    const current = catalog.filesByUri.get(uriKey(fileUri));
    const rel = path.join(path.dirname(current?.rel || "."),name);
    return catalog.paths.get(normalize(rel))?.[0]?.file || catalog.filesByUri.get(uriKey(new URL(encodeURIComponent(name),fileUri).href));
  }
  const file = companion ? sibling(uri,unit+".ini") || catalog.units.get(unit.toLowerCase())?.[0]?.file :
    declaration ? catalog.units.get(unit.toLowerCase())?.find(ref=>ref.kinds.includes(kind))?.file : undefined;
  const sourceUri = file?.uri || uri;
  const definition = file ? await materials.readIni(file) : !declaration && !companion ? doc : undefined;
  const unitType = field(definition?.sections.find(s=>/^general$/i.test(s.name)),"unittype")?.value || kind || "";
  const suffix = /aircraft|helicopter|vtol/i.test(unitType) || /\/aircraft\//i.test(sourceUri) ? "_squadrons.ini" : "_variants.ini";
  const appearanceFile = !companion && sibling(sourceUri,unit+suffix);
  const inline = doc.sections.some(s=>/^(?:variant|squadron)\d+$/i.test(s.name));
  const appearanceSource = appearanceFile && await materials.readIni(appearanceFile);
  const appearanceDoc = companion || inline ? await entityDocument(text,uri,catalog,materials) :
    appearanceSource ? await entityDocument(appearanceSource.lines.join("\n"),appearanceFile.uri,catalog,materials) : undefined;
  const options = appearanceDoc?.sections.filter(s=>/^(?:default|variant\d+|squadron\d+)$/i.test(s.name)) || [];
  const appearances: Choice[] = options.map(s=>{
    const header = appearanceDoc.lines[s.line]?.trim() || "";
    const comment = header.toLowerCase().startsWith("["+s.name.toLowerCase()+"]") ?
      header.slice(s.name.length+2).trim().replace(/^(?:#|;|\/\/)\s*/,"").trim() : "";
    return {id:s.name,label:comment ? s.name+" · "+comment : s.name};
  });
  const wanted = request.appearance || field(declaration,"squadronreference")?.value || field(declaration,"variantreference")?.value;
  const selected = options.find(s=>s.name.toLowerCase() === wanted?.toLowerCase()) ||
    (companion && options.find(s=>!/^default$/i.test(s.name))) || options[0];
  return {entities,entity:entity.id,appearances,appearance:selected?.name,sourceUri,
    sourceText:file ? definition?.lines.join("\n") : definition ? text : undefined,
    paint:{general:appearanceDoc?.sections.find(s=>/^general$/i.test(s.name)), defaults:options.find(s=>/^default$/i.test(s.name)), selected}};
}

export function paintTexture(paint: Appearance, id: string, usesHullMaterial: boolean) {
  const value = (key: string) => field(paint.selected,key)?.value ?? field(paint.defaults,key)?.value;
  const referenced = (key: string) => field(paint.general,key)?.value.toLowerCase().split(",").some(name=>name.trim() === id);
  let slot: string;
  if (referenced("serialnumberreferences")) slot = "serialnumber";
  else if (referenced("hullnumberreference")) slot = "hullnumber";
  else if (referenced("emblemreference")) slot = "emblem";
  else if (referenced("nationflagreference")) slot = "flag";
  else if (usesHullMaterial) slot = "livery";
  if (!slot) return;
  let name = value(slot+"texture");
  if (slot === "serialnumber") {
    const serial = value("serialnumbertextures")?.split(",")[0].trim();
    if (serial) name = (value("serialnumberprefix") || "")+serial;
  }
  if (name) return path.join(value("resources"+slot+"folder") || "",name);
}
