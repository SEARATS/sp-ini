import { posix as path } from "node:path";
import { PNG } from "pngjs";
import { Catalog, normalize } from "./catalog";
import { Materials } from "./materials";
import { MeshFiles, parseObj } from "./meshes";
import { referenceContext } from "./references";
import { StockAssets, resolvedDiffuse } from "./stock-assets";
import { field, entityParts, entityObjects, type EntityScene } from "./entity-model";
import { entityResourceSources, modelResource } from "./entity-resources";
import { type parse } from "./ini";
import { paintTexture, type Appearance } from "./entity-selection";

function triangles(model: ReturnType<typeof parseObj>, object: ReturnType<typeof parseObj>["objects"][number]) {
  const positions: number[] = [], uvs: number[] = [];
  for (const face of object.faces) for (let j=1; j+1<face.indices.length; j++) {
    const corners = [0,j,j+1];
    if (corners.some(i=>!model.vertices[face.indices[i]])) continue;
    for (const i of corners) {
      positions.push(...model.vertices[face.indices[i]]);
      uvs.push(...(model.uvs[face.texcoords[i]] || [0,0]));
    }
  }
  const encode = (values: number[]) => Buffer.from(new Float32Array(values).buffer).toString("base64");
  return positions.length ? {positions:encode(positions),uvs:encode(uvs)} : undefined;
}

function previewTexture(image: PNG, opaque: boolean): EntityScene["textures"][number] {
  let alpha: "opaque" | "cutout" | "blend" = "opaque";
  if (!opaque) for (let i=3;i<image.data.length;i+=4) {
    const a = image.data[i];
    if (a > 0 && a < 255) { alpha = "blend"; break; }
    if (!a) alpha = "cutout";
  }
  return {png:PNG.sync.write(image).toString("base64"),alpha};
}

export async function entityAssets(doc: ReturnType<typeof parse>, uri: string, catalog: Catalog, meshes: MeshFiles, materials: Materials, stock: StockAssets, paint: Appearance, resources: Awaited<ReturnType<typeof entityResourceSources>>, signal:AbortSignal) {
  const ctx = referenceContext(doc,uri,catalog), warnings = new Set<string>();
  const definitions = entityParts(doc,warnings), models = definitions[0].mesh?.section || doc.sections.find(s=>/^models$/i.test(s.name));
  const scene: EntityScene = {parts:[],geometry:[],textures:[],warnings:[]};
  const geometry = new Map<string,number | undefined>(), textures = new Map<string,number | undefined>(), modelFiles = new Map();
  if (resources.needsBlender) warnings.add("Install Blender or set Sea Power INI: Blender Path to preview .blend sources.");
  const chosenModels = new Map<string,ReturnType<typeof parseObj>>();
  for (const choice of resources.choices) {
    const files = resources.groups.get(choice.key);
    for (const file of choice.selected ? files.filter(f=>f.uri===choice.selected) : files) {
      signal.throwIfAborted();
      const model = await meshes.model(file,/\.blend$/i.test(file.full) ? {blender:resources.blender,signal} : undefined);
      if (model?.objects.some(o=>o.faces.length)) { chosenModels.set(choice.key,model); break; }
      warnings.add("Could not read geometry from "+file.rel);
    }
  }
  const missingDiffuse = new Set<string>();
  for (const {part,mesh,material} of definitions) {
    signal.throwIfAborted();
    scene.parts.push(part);
    if (part.primitive || !mesh || /^dummy$/i.test(mesh.value)) continue;
    const root = field(mesh.section,"rootmesh")?.value || field(models,"resourcesroot")?.value || "";
    const folder = field(mesh.section,"resourcesmeshfolder")?.value || ctx.resources || "";
    const scope = path.join(folder, root);
    const resource = modelResource(mesh.section,models);
    const key = JSON.stringify([resource?.key ?? scope,mesh.value]);
    if (!geometry.has(key)) {
      let data:ReturnType<typeof triangles>;
      if (resource && resources.groups.has(resource.key)) {
        const model = chosenModels.get(resource.key);
        const object = model?.objects.find(o=>o.name===mesh.value);
        if (object) data = triangles(model,object);
      } else {
        const [ref] = await meshes.resolve(doc,uri,{...mesh,name:part.collider ? "Collider" : "Mesh"},catalog,ctx,modelFiles);
        data = await catalog.withPacked(ref?.file,async()=>triangles(ref.model,ref.object),async()=>{
          if (/\.(?:obj|fbx)$/i.test(root)) return;
          const packed = await stock.read("Mesh",mesh.value,scope);
          if (packed) {
            const model = parseObj(packed.obj), object = model.objects.find(o=>o.faces.length);
            if (object) return triangles(model,object);
          }
        });
      }
      if (!data) warnings.add("Missing mesh "+mesh.value);
      geometry.set(key,data ? scene.geometry.push(data)-1 : undefined);
    }
    part.geometry = geometry.get(key);
    if (part.geometry === undefined || !material) continue;
    const matScope = path.join(field(mesh.section,"resourcesmaterialfolder")?.value || ctx.resources || "",material.value);
    const usesHullMaterial = material.value.toLowerCase() === definitions[0].material?.value.toLowerCase();
    const override = paintTexture(paint,part.id,usesHullMaterial);
    const textureKey = JSON.stringify([matScope,override]);
    if (!textures.has(textureKey)) {
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
      textures.set(textureKey,image ? scene.textures.push(previewTexture(image,!!override && usesHullMaterial))-1 : undefined);
    }
    part.texture = textures.get(textureKey);
    if (missingDiffuse.has(textureKey)) part.missingDiffuse = true;
  }
  scene.warnings = [...warnings];
  scene.objects = entityObjects(doc,scene.parts);
  return scene;
}
