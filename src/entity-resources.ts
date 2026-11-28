import * as fs from "node:fs/promises";
import { basename, dirname, join, posix as path } from "node:path";
import { pathToFileURL } from "node:url";
import { Catalog, normalize, uriKey } from "./catalog";
import { findBlender } from "./blend-export";
import { entityParts, field } from "./entity-model";
import type { IniSection, parse } from "./ini";
import { modelResourcePath } from "./model-resource-path";

const formats = [".fbx",".obj",".blend"];
interface SourceFile {uri:string; rel:string; full:string; source:string}
export interface ModelSourceChoice {key:string; files:{id:string;label:string}[]; selected:string}

export function modelResource(section: IniSection, models: IniSection) {
  const folder = field(section,"resourcesmeshfolder")?.value || field(models,"resourcesmeshfolder")?.value || field(models,"resourcesfolder")?.value || "";
  const root = field(section,"rootmesh")?.value || field(models,"resourcesroot")?.value || field(models,"resourcesmesh")?.value;
  if (!root) return;
  const stem = normalize(modelResourcePath(root).file).replace(/\.(fbx|obj|blend|prefab)$/i,"");
  return {key:path.join(normalize(folder),stem), folder:normalize(folder), stem};
}

async function siblingModels(anchor: SourceFile) {
  const dir = dirname(anchor.full), stem = path.parse(basename(anchor.full)).name.toLowerCase();
  const entries = await fs.readdir(dir,{withFileTypes:true}).catch(()=>[]);
  return formats.flatMap(ext => entries.filter(e=>e.isFile() && e.name.toLowerCase()===stem+ext).map(e=>{
    const full = join(dir,e.name);
    return {full,rel:path.join(path.dirname(anchor.rel),e.name),uri:pathToFileURL(full).href,source:anchor.source};
  }));
}

export async function entityResourceSources(doc: ReturnType<typeof parse>, uri:string, catalog:Catalog, overrides:Record<string,string> = {}, blenderPath?:string) {
  const models = doc.sections.find(s=>/^models$/i.test(s.name));
  const local = path.dirname(normalize(catalog.filesByUri.get(uriKey(uri))?.rel || ""));
  const groups = new Map<string,SourceFile[]>(), choices:ModelSourceChoice[] = [];
  let blender: string | undefined, needsBlender = false;
  const targets = new Map<string,ReturnType<typeof modelResource>>();
  if (models) for (const {mesh,part} of entityParts(doc,new Set())) {
    if (!mesh || part.primitive || /^dummy$/i.test(mesh.value)) continue;
    const resource = modelResource(mesh.section,models);
    if (resource) targets.set(resource.key,resource);
  }
  for (const resource of targets.values()) {
    const locations = resource.folder ? [resource.key,path.join(local,resource.key)] : [path.join(local,resource.stem),resource.stem];
    const refs = [...new Set(locations)].flatMap(stem => catalog.ordered([...formats,".prefab"].flatMap(ext=>catalog.assets.get(stem+ext) || [])));
    // Unity mirrors can place the FBX outside Resources. Its manifest supplies the directory to inspect.
    refs.push(...catalog.mirrorModels.get(resource.stem) || []);
    const checked = new Set<string>();
    for (const {file} of refs) {
      const directoryStem = join(dirname(file.full),path.parse(basename(file.full)).name);
      if (checked.has(directoryStem)) continue;
      checked.add(directoryStem);
      const files = await siblingModels(file);
      if (!files.length) continue;
      if (blender === undefined && files.some(f=>/\.blend$/i.test(f.full))) blender = await findBlender(blenderPath).catch(()=>"");
      const usable = files.filter(f=>blender || !/\.blend$/i.test(f.full));
      if (!usable.length) { needsBlender = true; continue; }
      groups.set(resource.key,usable);
      choices.push({key:resource.key,selected:usable.length>1 && usable.some(f=>f.uri===overrides[resource.key]) ? overrides[resource.key] : "",
        files:usable.map(f=>({id:f.uri,label:basename(f.full)}))});
      break;
    }
  }
  return {groups,choices,blender,needsBlender};
}
