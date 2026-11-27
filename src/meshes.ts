import { readBlendPreview } from "./blend-export";
import { fbxGeometry } from "./fbx-geometry";
import * as fs from "node:fs/promises";
import { reference, referenceContext, isMesh } from "./references";

const objectHeader = /^\s*o\s+([^#]+?)(?:\s*#.*)?$/;

function parseObj(text: string, groupObjects = false) {
  const vertices = [], uvs = [], objects = [], libraries = [];
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
    } else if (/^v\s/.test(data)) {
      const point = data.slice(1).trim().split(/\s+/, 3).map(Number);
      vertices.push(point.length === 3 && point.every(Number.isFinite) ? point : null);
      if (object) object.vertexCount++;
    } else if ((object || activeGroups.length) && /^f\s/.test(data)) {
      const indices = [], texcoords = [];
      for (const token of data.slice(1).trim().split(/\s+/)) {
        const [v, t] = token.split("/", 2).map(Number);
        indices.push(v < 0 ? vertices.length + v : v - 1);
        texcoords.push(t < 0 ? uvs.length + t : t - 1);
      }
      if (indices.length >= 3) {
        const face = { indices, texcoords, material };
        if (object) object.faces.push(face);
        else activeGroups.forEach(group => group.faces.push(face));
      }
    }
  }
  return { vertices, uvs, objects, libraries };
}

export function triangles(model: ReturnType<typeof parseObj>, object: ReturnType<typeof parseObj>["objects"][number]) {
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

class MeshFiles {
  constructor(private readonly openDocument: (uri: string) => Pick<import('vscode-languageserver-textdocument').TextDocument, 'getText' | 'version'> = () => undefined) {}
  cache = new Map();

  async model(file, blend?: {blender:string;signal:AbortSignal}) {
    const doc = this.openDocument(file.uri);
    const stamp = doc ? undefined : await fs.stat(file.full).catch(() => null);
    if (!stamp && !doc) return;
    const version = doc ? "open:" + doc.version : stamp.mtimeMs + ":" + stamp.size + ":" + (blend?.blender || "");
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
    const explicit = /\.(obj|fbx)$/i.test(root.value);
    const refs = explicit ? reference(root,root.value,context).refs : catalog.ordered([
      ...reference(root,root.value+".obj",context).refs, ...reference(root,root.value+".fbx",context).refs,
      ...catalog.mirrorModels.get(root.value.toLowerCase()) || [], ...(!all && catalog.mirrorMeshes.get(entry.value.toLowerCase()) || [])
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
