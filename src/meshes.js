const fs = require("node:fs/promises");
const { reference, referenceContext, isMesh } = require("./references");

const objectHeader = /^\s*o\s+([^#]+?)(?:\s*#.*)?$/;

function parseObj(text) {
  const vertices = [], uvs = [], objects = [], libraries = [];
  let object, material;
  for (const [line, raw] of text.split(/\r\n|\n|\r/).entries()) {
    const data = raw.split("#", 1)[0].trim();
    if (/^o(?:\s|$)/.test(data)) {
      const name = data.slice(1).trim();
      object = { name, line, start: raw.indexOf(name, raw.indexOf("o") + 1),
        faces: [], firstVertex: vertices.length, vertexCount: 0 };
      if (name) objects.push(object);
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
    } else if (object && /^f\s/.test(data)) {
      const indices = [], texcoords = [];
      for (const token of data.slice(1).trim().split(/\s+/)) {
        const [v, t] = token.split("/", 2).map(Number);
        indices.push(v < 0 ? vertices.length + v : v - 1);
        texcoords.push(t < 0 ? uvs.length + t : t - 1);
      }
      if (indices.length >= 3) object.faces.push({ indices, texcoords, material });
    }
  }
  return { vertices, uvs, objects, libraries };
}

class MeshFiles {
  constructor(openDocument = () => undefined) { this.openDocument = openDocument; }
  cache = new Map();

  async model(file) {
    const doc = this.openDocument(file.uri);
    const stamp = doc || await fs.stat(file.full).catch(() => null);
    if (!stamp) return;
    const version = doc ? "open:" + doc.version : stamp.mtimeMs + ":" + stamp.size;
    const cached = this.cache.get(file.uri);
    if (cached?.version === version && cached.doc === doc) return cached.model;
    const text = doc ? doc.getText() : await fs.readFile(file.full, "utf8").catch(() => null);
    if (text === null) return;
    const model = parseObj(text);
    if (this.cache.size >= 3) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(file.uri, { version, doc, model });
    return model;
  }

  async resolve(doc, uri, entry, catalog, ctx = referenceContext(doc, uri, catalog), modelsByUri) {
    if (!entry) return [];
    if (!isMesh(entry, ctx.meshColliders)) return [];
    const models = doc.sections.find(s => /^models$/i.test(s.name));
    const root = entry.section?.keys.find(k => /^rootmesh$/i.test(k.name) && k.value) ||
      models?.keys.find(k => /^resourcesroot$/i.test(k.name));
    if (!root || !/\.obj$/i.test(root.value)) return [];
    const resources = entry.section?.keys.find(k => /^resourcesmeshfolder$/i.test(k.name))?.value || ctx.resources;
    const refs = reference(root, root.value, { ...ctx, resources }).refs;
    const result = [];
    for (const { file } of refs) {
      let loading = modelsByUri?.get(file.uri);
      if (!loading) {
        loading = this.model(file);
        modelsByUri?.set(file.uri, loading);
      }
      const model = await loading;
      for (const object of model?.objects || []) {
        if (object.name === entry.value) result.push({ file, model, object, name: object.name, line: object.line, start: object.start });
      }
    }
    return result;
  }
}

module.exports = { MeshFiles, objectHeader, parseObj };
