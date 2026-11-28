import { readBlendPreview } from "./blend-export";
import { fbxGeometry } from "./fbx-geometry";
import * as fs from "node:fs/promises";
import { modelResourcePath } from "./model-resource-path";
import { PreviewCache } from "./preview-cache";
import { reference, referenceContext, isMesh } from "./references";

const objectHeader = /^\s*o\s+([^#]+?)(?:\s*#.*)?$/;

function parseObj(text: string, groupObjects = false) {
  const vertices = [], normals = [], uvs = [], objects = [], libraries = [];
  let object, material;
  const groups = new Map<string, typeof object>();
  let activeGroups = [];
  for (const [line, raw] of text.split(/\r\n|\n|\r/).entries()) {
    const data = raw.split("#", 1)[0].trim();
    if (!groupObjects && /^o(?:\s|$)/.test(data)) {
      const name = data.slice(1).trim();
      object = { name, line, start: raw.indexOf(name, raw.indexOf("o") + 1),
        faces: [], firstVertex: vertices.length, vertexCount: 0 };
      if (name) objects.push(object);
    } else if (groupObjects && /^g(?:\s|$)/.test(data)) {
      activeGroups = [...new Set(data.slice(1).trim().split(/\s+/).filter(Boolean))].map(name => {
        if (!groups.has(name)) {
          const group = {name, line, start:raw.indexOf(name), faces:[], firstVertex:0, vertexCount:0};
          groups.set(name, group);
          objects.push(group);
        }
        return groups.get(name);
      });
    } else if (/^mtllib\s/.test(data)) {
      libraries.push(data.slice(6).trim());
    } else if (/^usemtl\s/.test(data)) {
      material = data.slice(6).trim();
    } else if (/^vt\s/.test(data)) {
      const uv = data.slice(2).trim().split(/\s+/, 2).map(Number);
      uvs.push(uv.length === 2 && uv.every(Number.isFinite) ? uv : null);
    } else if (/^vn?\s/.test(data)) {
      const normal = data.startsWith("vn");
      const point = data.slice(normal ? 2 : 1).trim().split(/\s+/, 3).map(Number);
      (normal ? normals : vertices).push(point.length === 3 && point.every(Number.isFinite) ? point : null);
      if (!normal && object) object.vertexCount++;
    } else if ((object || activeGroups.length) && /^f\s/.test(data)) {
      const indices = [], texcoords = [], normalIndices = [];
      for (const token of data.slice(1).trim().split(/\s+/)) {
        const [v, t, n] = token.split("/").map(Number);
        indices.push(v < 0 ? vertices.length + v : v - 1);
        texcoords.push(t < 0 ? uvs.length + t : t - 1);
        normalIndices.push(n < 0 ? normals.length+n : n-1);
      }
      if (indices.length >= 3) {
        const face = { indices, texcoords, normalIndices, material };
        if (object) object.faces.push(face);
        else activeGroups.forEach(group => group.faces.push(face));
      }
    }
  }
  return { vertices, normals, uvs, objects, libraries };
}

export function triangles(model: ReturnType<typeof parseObj>, object: ReturnType<typeof parseObj>["objects"][number], mirrorX = false) {
  const positions: number[] = [], uvs: number[] = [], normals:number[] = [];
  for (const face of object.faces) for (let j=1; j+1<face.indices.length; j++) {
    const corners = mirrorX ? [0,j+1,j] : [0,j,j+1];
    if (corners.some(i=>!model.vertices[face.indices[i]])) continue;
    for (const i of corners) {
      const [x,y,z] = model.vertices[face.indices[i]];
      positions.push(mirrorX ? -x : x,y,z);
      const normal = model.normals?.[face.normalIndices?.[i]];
      if (normal) normals.push(mirrorX ? -normal[0] : normal[0],normal[1],normal[2]);
      uvs.push(...(model.uvs[face.texcoords[i]] || [0,0]));
    }
  }
  const encode = (values: number[]) => Buffer.from(new Float32Array(values).buffer).toString("base64");
  return positions.length ? {positions:encode(positions),uvs:encode(uvs),normals:normals.length===positions.length ? encode(normals) : undefined} : undefined;
}

class MeshFiles {
  constructor(private readonly openDocument: (uri: string) => Pick<import('vscode-languageserver-textdocument').TextDocument, 'getText' | 'version'> = () => undefined) {}
  cache = new Map();
  previewCache = new PreviewCache();
  private buffers = new WeakMap<object,Map<boolean,ReturnType<typeof triangles>>>();

  previewTriangles(model:ReturnType<typeof parseObj>, object:ReturnType<typeof parseObj>["objects"][number], mirror:boolean) {
    let sides = this.buffers.get(object);
    if (!sides) this.buffers.set(object,sides=new Map());
    if (!sides.has(mirror)) sides.set(mirror,triangles(model,object,mirror));
    return sides.get(mirror);
  }

  async previewSource(file, blend?: {blender:string;signal:AbortSignal}) {
    // A Blender file can link external assets. Open documents can contain unsaved geometry.
    const persistent = this.previewCache.directory && !blend && !this.openDocument(file.uri);
    const stat = persistent && await fs.stat(file.full).catch(()=>undefined);
    const key = stat && [file.uri,stat.size,stat.mtimeMs,stat.ctimeMs];
    let loading:Promise<ReturnType<typeof parseObj>>;
    const model = () => loading ??= this.model(file,blend);
    const names = async () => (await model())?.objects.filter(o=>o.faces.length).map(o=>o.name);
    const drawable = key ? await this.previewCache.get(["objects",...key],names) : await names();
    if (!drawable?.length) return;
    const objects = new Set(drawable);
    return async (name:string, mirror:boolean) => {
      if (!objects.has(name)) return;
      const build = async () => {
        const source = await model(), object = source?.objects.find(o=>o.name===name && o.faces.length);
        if (object) return this.previewTriangles(source,object,mirror);
      };
      return key ? this.previewCache.get(["triangles",...key,name,mirror],build) : build();
    };
  }

  async model(file, blend?: {blender:string;signal:AbortSignal}) {
    const doc = this.openDocument(file.uri);
    const stamp = doc ? undefined : await fs.stat(file.full).catch(() => null);
    if (!stamp && !doc) return;
    const version = doc ? "open:" + doc.version : [stamp.mtimeMs,stamp.ctimeMs,stamp.size,blend?.blender].join(":");
    const cached = this.cache.get(file.uri);
    if (cached?.version === version && cached.doc === doc) return cached.model;
    let model;
    try {
      const text = doc?.getText();
      if (/\.blend$/i.test(file.full)) {
        if (!blend?.blender) return;
        model = fbxGeometry(await readBlendPreview(file.full,blend.blender,blend.signal));
      } else if (/\.fbx$/i.test(file.full)) {
        const bytes = text !== undefined && !text.startsWith("Kaydara FBX Binary") ? Buffer.from(text) : await fs.readFile(file.full);
        model = fbxGeometry(bytes);
      } else model = parseObj(text ?? await fs.readFile(file.full, "utf8"));
    } catch { return; }
    if (this.cache.size >= 3) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(file.uri, { version, doc, model });
    return model;
  }

  async resolve(doc, uri, entry, catalog, ctx = referenceContext(doc, uri, catalog), modelsByUri?: Map<string, Promise<ReturnType<typeof parseObj>>>, all = false) {
    if (!entry) return [];
    if (!isMesh(entry, ctx.meshColliders)) return [];
    const models = doc.sections.find(s => /^models$/i.test(s.name));
    const root = entry.section?.keys.find(k => /^rootmesh$/i.test(k.name) && k.value) ||
      models?.keys.find(k => /^resourcesroot$/i.test(k.name));
    if (!root) return [];
    const resources = entry.section?.keys.find(k => /^resourcesmeshfolder$/i.test(k.name))?.value || ctx.resources;
    const context = { ...ctx, resources };
    const {file} = modelResourcePath(root.value);
    const explicit = /\.(obj|fbx)$/i.test(file);
    const refs = explicit ? reference(root,file,context).refs : catalog.ordered([
      ...reference(root,file+".obj",context).refs, ...reference(root,file+".fbx",context).refs,
      ...catalog.mirrorModels.get(file.toLowerCase()) || [], ...(!all && catalog.mirrorMeshes.get(entry.value.toLowerCase()) || [])
    ]);
    const result = [];
    for (const { file } of refs) {
      let loading = modelsByUri?.get(file.uri);
      if (!loading) {
        loading = this.model(file);
        modelsByUri?.set(file.uri, loading);
      }
      const model = await loading;
      for (const object of model?.objects || []) {
        if (all || object.name === entry.value) result.push({ file, model, object, name: object.name, line: object.line, start: object.start });
      }
    }
    return result;
  }
}

export { MeshFiles, objectHeader, parseObj };
