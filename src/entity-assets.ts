import { posix as path } from "node:path";
import { createHash } from "node:crypto";
import { setImmediate as yieldToIO } from "node:timers/promises";
import { PNG } from "pngjs";
import { Catalog, normalize } from "./catalog";
import { modelResourcePath } from "./model-resource-path";
import { Materials } from "./materials";
import { MeshFiles, parseObj, triangles } from "./meshes";
import { referenceContext } from "./references";
import { StockAssets, resolvedDiffuse } from "./stock-assets";
import { field, entityParts, entityObjects, type EntityScene, type EntityChunk } from "./entity-model";
import { entityResourceSources, modelResource } from "./entity-resources";
import { type parse } from "./ini";
import { paintTexture, type Appearance } from "./entity-selection";
import { entitySpins } from "./entity-spins";
import { elevatorTravel } from "./elevator-travel";

async function previewTexture(image: PNG, opaque: boolean): Promise<EntityScene["textures"][number]> {
  let alpha: "opaque" | "cutout" | "blend" = "opaque";
  if (!opaque) for (let i=3;i<image.data.length;i+=4) {
    const a = image.data[i];
    if (a > 0 && a < 255) { alpha = "blend"; break; }
    if (!a) alpha = "cutout";
  }
  const output = new PNG({width:image.width,height:image.height});
  output.data=image.data;
  const chunks:Buffer[]=[];
  await new Promise<void>((resolve,reject)=>{
    output.on("data",chunk=>chunks.push(chunk)).once("end",resolve).once("error",reject);
    output.pack();
  });
  return {png:Buffer.concat(chunks).toString("base64"),alpha};
}

// Once per unique buffer in this build. Repeated parts already reference its scene index.
export function reusePreviewAsset(chunk:EntityChunk, known:Set<string>):EntityChunk {
  if (chunk.kind==="parts" || !chunk.data) return chunk;
  const hash = createHash("sha256").update(chunk.kind);
  if (chunk.kind==="geometry") {
    hash.update(chunk.data.positions).update("|").update(chunk.data.uvs).update("|").update(chunk.data.normals ?? "");
  } else hash.update(chunk.data.alpha).update(chunk.data.png);
  const digest=hash.digest("hex");
  return {...chunk,digest,...(known.has(digest) ? {data:undefined} : {})};
}

export async function entityAssets(doc: ReturnType<typeof parse>, uri: string, catalog: Catalog, meshes: MeshFiles, materials: Materials, stock: StockAssets, paint: Appearance, resources: Awaited<ReturnType<typeof entityResourceSources>>, signal:AbortSignal, emit?: (chunk:EntityChunk)=>Promise<void>, watch?:(uri:string)=>void) {
  const ctx = referenceContext(doc,uri,catalog), warnings = new Set<string>();
  const definitions = entityParts(doc,warnings), models = definitions[0].mesh?.section || doc.sections.find(s=>/^models$/i.test(s.name));
  const scene: EntityScene = {parts:[],geometry:[],textures:[],warnings:[]};
  const geometry = new Map<string,number | undefined>(), textures = new Map<string,number | undefined>(), modelFiles = new Map();
  if (resources.needsBlender) warnings.add("Install Blender or set Sea Power INI: Blender Path to preview .blend sources.");
  const chosenModels = new Map<string,Awaited<ReturnType<typeof chooseModel>>>();
  async function chooseModel(key:string) {
    const choice = resources.choices.find(c=>c.key===key);
    const files = resources.groups.get(key);
    for (const file of choice.selected ? files.filter(f=>f.uri===choice.selected) : files) {
      watch?.(file.uri);
      signal.throwIfAborted();
      const lookup = await meshes.previewSource(file,/\.blend$/i.test(file.full) ? {blender:resources.blender,signal} : undefined);
      if (lookup) return {lookup,obj:/\.obj$/i.test(file.full)};
      warnings.add("Could not read geometry from "+file.rel);
    }
  }
  const missingDiffuse = new Set<string>();
  await emit?.({kind:"parts",parts:definitions.map(({part})=>({...part}))});
  let textureWork=Promise.resolve(), stopped=false, textureFailure:Error;
  async function loadGeometry(definition:typeof definitions[number]) {
    const {part,mesh,material}=definition;
    signal.throwIfAborted();
    scene.parts.push(part);
    if (part.primitive || !mesh || /^dummy$/i.test(mesh.value)) return;
    const {file:root,mirrorObjX} = modelResourcePath(field(mesh.section,"rootmesh")?.value || field(models,"resourcesroot")?.value || "");
    const folder = field(mesh.section,"resourcesmeshfolder")?.value || ctx.resources || "";
    const scope = path.join(folder, root);
    const resource = modelResource(mesh.section,models);
    const key = JSON.stringify([resource?.key ?? scope,mesh.value,mirrorObjX]);
    const newGeometry = !geometry.has(key);
    if (newGeometry) {
      let data:ReturnType<typeof triangles>;
      if (resource && resources.groups.has(resource.key)) {
        if (!chosenModels.has(resource.key)) chosenModels.set(resource.key,await chooseModel(resource.key));
        const source = chosenModels.get(resource.key);
        data = await source?.lookup(mesh.value,source.obj && mirrorObjX);
      } else {
        const [ref] = await meshes.resolve(doc,uri,{...mesh,name:part.collider ? "Collider" : "Mesh"},catalog,ctx,modelFiles);
        if (ref) watch?.(ref.file.uri);
        data = await catalog.withPacked(ref?.file,async()=>meshes.previewTriangles(ref.model,ref.object,mirrorObjX && /\.obj$/i.test(ref.file.full)),async()=>{
          if (/\.(?:obj|fbx)$/i.test(root)) return;
          const packed = await stock.read("Mesh",mesh.value,scope);
          if (packed) {
            const digest = createHash("sha256").update(packed.obj).digest("hex");
            return meshes.previewCache.get(["packed",digest],async()=>{
              const model = parseObj(packed.obj), object = model.objects.find(o=>o.faces.length);
              if (object) return triangles(model,object);
            });
          }
        });
      }
      if (!data) warnings.add("Missing mesh "+mesh.value);
      geometry.set(key,data ? scene.geometry.push(data)-1 : undefined);
    }
    part.geometry = geometry.get(key);
    if (part.geometry!==undefined) await emit?.({kind:"geometry",part:part.id,index:part.geometry,data:newGeometry ? scene.geometry[part.geometry] : undefined});
    if (part.geometry !== undefined && material) {
      // One background texture job at a time leaves the mesh lane free and bounds decoded image memory.
      textureWork=textureWork.then(async()=>{
        await yieldToIO();
        if (!stopped && !textureFailure && !signal.aborted) await loadTexture(definition);
      }).catch(error=>{textureFailure=error;});
    }
  }
  async function loadTexture({part,mesh,material}:typeof definitions[number]) {
    const matScope = path.join(field(mesh.section,"resourcesmaterialfolder")?.value || ctx.resources || "",material.value);
    const usesHullMaterial = material.value.toLowerCase() === definitions[0].material?.value.toLowerCase();
    const override = paintTexture(paint,part.id,usesHullMaterial);
    const textureKey = JSON.stringify([matScope,override]);
    const newTexture = !textures.has(textureKey);
    if (newTexture) {
      const file = materials.materialFile(material,doc,uri,catalog);
      let image;
      if (override) {
        const paths = /\.(png|jpe?g)$/i.test(override) ? [override] : [override+".png",override+".jpg",override+".jpeg"];
        const loose = catalog.ordered(paths.flatMap(p=>catalog.assets.get(normalize(p)) || []))[0]?.file;
        image = await catalog.withPacked(loose,()=>materials.texture(loose),async()=>{
          const packed = await stock.read("Texture2D",path.parse(override).name,override.replace(/\.(png|jpe?g)$/i,""));
          if (packed) return PNG.sync.read(Buffer.from(packed.png,"base64"));
        });
        if (!image) warnings.add("Missing appearance texture "+override);
      }
      image ??= await resolvedDiffuse(stock,materials,catalog,file,material.value,matScope);
      if (!image) {
        warnings.add("No diffuse texture for "+material.value);
        if (override || (file && (await materials.materialData(file,catalog)).maps.some(m => /^_(maintex|basemap|basecolormap)$/i.test(m.key.name) && m.key.value))) {
          missingDiffuse.add(textureKey);
        }
      }
      let texture:EntityScene["textures"][number];
      if (image) {
        const opaque = !!override && usesHullMaterial;
        const digest = createHash("sha256").update(image.data).digest("hex");
        texture = await meshes.previewCache.get(["texture",image.width,image.height,opaque,digest],async()=>previewTexture(image,opaque));
      }
      textures.set(textureKey,texture ? scene.textures.push(texture)-1 : undefined);
    }
    part.texture = textures.get(textureKey);
    if (!stopped && !signal.aborted && part.texture!==undefined) await emit?.({kind:"texture",part:part.id,index:part.texture,data:newTexture ? scene.textures[part.texture] : undefined});
    if (missingDiffuse.has(textureKey)) part.missingDiffuse = true;
  }
  try {
    for (const definition of definitions) await loadGeometry(definition);
    scene.elevators = await elevatorTravel(doc,scene.parts,catalog,materials,warnings);
    scene.objects = entityObjects(doc,scene.parts,scene.elevators);
    scene.spins = await entitySpins(doc,scene.parts,catalog,materials);
    await textureWork;
    if (textureFailure) throw textureFailure;
    signal.throwIfAborted();
    scene.warnings = [...warnings];
    return scene;
  } finally { stopped=true; }
}
