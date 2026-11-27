import * as fs from "node:fs/promises";
import { posix as path } from "node:path";
import { TGALoader } from "three/examples/jsm/loaders/TGALoader.js";
import { PNG } from "pngjs";
import * as jpeg from "jpeg-js";
import { parse } from "./ini";
import { normalize } from "./catalog";
import { reference, referenceContext } from "./references";
import { materialProperties, unityPropertyDiagnostics } from "./material-properties";
import { unityMaterial } from "./unity-material";
import { materialSwatch } from "./material-swatch";

const escape = text => text.replace(/[^\p{L}\p{N} _-]/gu, ch => "\\" + ch);
function imageUri(image, budget = 42000) {
  let png = PNG.sync.write(image);
  if (png.length * 4 / 3 > budget) {
    const pixels = Buffer.from(image.data);
    // JPEG has no alpha channel. Composite transparent texels on a checkerboard.
    for (let i = 0; i < pixels.length; i += 4) {
      const x = i / 4 % image.width, y = Math.floor(i / 4 / image.width);
      const background = ((x >> 3) + (y >> 3)) % 2 ? 185 : 203;
      const alpha = pixels[i + 3] / 255;
      for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(pixels[i + c] * alpha + background * (1 - alpha));
    }
    for (const quality of [85, 65, 45]) {
      const encoded = jpeg.encode({ width: image.width, height: image.height, data: pixels }, quality).data;
      if (encoded.length * 4 / 3 <= budget) return "data:image/jpeg;base64," + encoded.toString("base64");
    }
  }
  // VS Code truncates long Markdown blocks, including data URLs inside them.
  while (png.length * 4 / 3 > budget && Math.max(image.width, image.height) > 1) {
    image = resize(image, Math.max(1, Math.floor(Math.max(image.width, image.height) * 0.8)));
    png = PNG.sync.write(image);
  }
  return "data:image/png;base64," + png.toString("base64");
}
function imageMarkdown(name, image, budget = 42000) {
  return "![" + name + "](" + imageUri(image,budget) + ")";
}

function resize(source, limit) {
  const factor = Math.min(1, limit / Math.max(source.width, source.height));
  const image = new PNG({ width: Math.max(1, Math.round(source.width * factor)), height: Math.max(1, Math.round(source.height * factor)) });
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const offset = 4 * (Math.floor(y * source.height / image.height) * source.width + Math.floor(x * source.width / image.width));
    image.data.writeUInt32BE(source.data.readUInt32BE(offset), 4 * (y * image.width + x));
  }
  return image;
}

function diffusePreview(image, doc) {
  if (!image) return;
  const setting = (section, key) => doc?.sections.find(s => s.name.toLowerCase() === section)?.keys
    .find(k => k.name.toLowerCase() === key)?.value;
  const shader = setting("shader", "path") || "";
  const mode = Number(setting("properties", "_mode")?.split(",").at(-1));
  const standard = /^standard(?:$| )/i.test(shader);
  const cutout = /cutout/i.test(shader) || (standard && mode === 1);
  if (!cutout && (/transparent|alpha blended|additive/i.test(shader) || (standard && [2, 3].includes(mode)))) return image;
  const threshold = Number(setting("properties", "_cutoff")?.split(",").at(-1) ?? 0.5);
  const cutoff = (Number.isFinite(threshold) ? Math.min(1, Math.max(0, threshold)) : 0.5) * 255;
  const data = Buffer.from(image.data);
  for (let i = 3; i < data.length; i += 4) data[i] = cutout && data[i] < cutoff ? 0 : 255;
  return { width: image.width, height: image.height, data };
}

class Materials {
  cache = new Map();
  constructor(private readonly openIni: (uri: string) => ReturnType<typeof parse>) {}

  async readIni(file) {
    return this.openIni(file.uri) || await fs.readFile(file.full, "utf8").then(parse, () => null);
  }

  async texture(file, maxSize=384) {
    if (!file || !/\.(png|jpe?g|tga)$/i.test(file.rel)) return;
    const stat = await fs.stat(file.full).catch(() => null);
    if (!stat || stat.size > 96 * 1024 * 1024) return;
    const key = file.uri+"#"+maxSize, old = this.cache.get(key);
    if (old?.stamp === stat.mtimeMs && old.size === stat.size) return old.image;
    let image;
    try {
      const bytes = await fs.readFile(file.full);
      const png = /\.png$/i.test(file.rel);
      if (png && bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 32 * 1024 * 1024) return;
      if (/\.tga$/i.test(file.rel)) {
        if (bytes.length < 18 || bytes.readUInt16LE(12)*bytes.readUInt16LE(14) > 32*1024*1024 || ![8,16,24,32].includes(bytes[16])) return;
        const decoded = new TGALoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer) as unknown as {width:number; height:number; data:Uint8Array};
        image = resize({...decoded, data:Buffer.from(decoded.data)},maxSize);
      } else {
        const source = png ? PNG.sync.read(bytes) : jpeg.decode(bytes, {maxResolutionInMP:32, maxMemoryUsageInMB:256});
        image = resize(source,maxSize);
      }
    } catch { return; }
    if (this.cache.size >= 24) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, { stamp: stat.mtimeMs, size: stat.size, image });
    return image;
  }

  materialFile(entry, doc, uri, catalog) {
    if (!entry || !/^(resourcesmaterial|material)$/i.test(entry.name)) return;
    const ctx = referenceContext(doc, uri, catalog);
    ctx.resources = entry.section.keys.find(k => /^resourcesmaterialfolder$/i.test(k.name))?.value || ctx.resources;
    if (/\.(ini|mat)$/i.test(entry.value)) return reference(entry,entry.value,ctx).refs[0]?.file;
    const refs = [...reference(entry,entry.value+".ini",ctx).refs, ...reference(entry,entry.value+".mat",ctx).refs, ...reference(entry,entry.value,ctx).refs];
    return catalog.ordered(refs.filter(r=>/\.(ini|mat)$/i.test(r.file.rel)))[0]?.file;
  }

  maps(file, catalog, doc) {
    if (!doc) return [];
    const ctx = referenceContext(doc, file.uri, catalog);
    return (doc.sections.find(s => /^textures$/i.test(s.name))?.keys || []).map(key => ({
      key, file: reference(key, key.value, ctx).refs[0]?.file
    }));
  }

  async materialData(file,catalog,check = false) {
    if (!/\.mat$/i.test(file.rel)) {
      const doc = await this.readIni(file);
      return {doc,maps:this.maps(file,catalog,doc),issues:check && doc ? materialProperties(doc) : []};
    }
    const text = await fs.readFile(file.full,"utf8").catch(() => "");
    const asset = unityMaterial(text);
    const maps = (asset?.maps ?? []).map(({name,guid}) => {
      const texture = catalog.textureByGuid(guid,file.full);
      return {key:{name,value:texture?.rel ?? guid},file:texture};
    });
    return {doc:asset?.doc,maps,issues:check ? unityPropertyDiagnostics(text) : []};
  }

  async preview(file, catalog, images = true, check = false) {
    const {doc,maps,issues} = await this.materialData(file,catalog,check);
    const textures = new Map();
    if (images) for (const map of maps) textures.set(map.key.name.toLowerCase(), await this.texture(map.file));
    const preview = this.tiles(file.rel,doc,maps,textures,images);
    if (!doc && /\.mat$/i.test(file.rel)) preview.note = "Preview requires a text-serialized Unity material (.mat).";
    return {...preview,issues:issues.map(d=>"Line "+(d.range.start.line+1)+". "+d.message)};
  }

  tiles(name, doc, maps, textures, images = true) {
    const props = doc?.sections.find(s => /^properties$/i.test(s.name))?.keys || [];
    const swatch = images && materialSwatch(textures, new Map(props.map(k => [k.name.toLowerCase(), k.value])));
    const budget = Math.floor(84000 / (maps.length + 1));
    return {name, properties:props.map(k=>({name:k.name,value:k.value})), lit:swatch ? imageUri(swatch,budget) : undefined, note:"",
      maps:maps.map(({key,file}) => {
        const raw = textures.get(key.name.toLowerCase());
        const image = /^_(maintex|basemap|basecolormap)$/i.test(key.name) ? diffusePreview(raw,doc) : raw;
        return {slot:key.name, path:key.value, image:image ? imageUri(resize(image,144),budget) : undefined,
          status:file || raw ? "Preview unavailable" : "File missing"};
      })};
  }

  async hover(file, catalog, images = true) {
    const preview = await this.preview(file,catalog,images);
    if (!images || preview.note) return {contents:{kind:"plaintext" as const,
      value:[preview.name,preview.note,...preview.maps.map(m => m.slot+"="+m.path)].filter(Boolean).join("\n")}};
    return this.markdown(preview);
  }

  render(name, doc, maps, textures) {
    return this.markdown(this.tiles(name,doc,maps,textures));
  }

  private markdown(preview: ReturnType<Materials["tiles"]>) {
    const parts = ["**" + escape(path.basename(preview.name)) + "**"];
    if (!preview.maps.length && preview.lit) parts.push("![Lit material]("+preview.lit+")");
    for (let i = 0; i < preview.maps.length; i += 3) {
      const group = preview.maps.slice(i,i+3);
      const labels = group.map(m => escape(m.slot));
      const previews = group.map(m => m.image ? "![Texture]("+m.image+")" : m.status);
      if (!i && preview.lit) { labels.unshift("Lit material"); previews.unshift("![Lit material]("+preview.lit+")"); }
      parts.push([labels, labels.map(() => "---"), previews].map(row => "| " + row.join(" | ") + " |").join("\n"));
    }
    if (preview.maps.length) parts.push(preview.maps.map(m => escape(m.slot) + " · " + escape(path.basename(m.path))).join("  \n"));
    return {contents:{kind:"markdown" as const,value:parts.join("\n\n")}};
  }

  async diffuse(file, catalog) {
    const {doc,maps} = await this.materialData(file,catalog);
    const main = ["_basemap","_basecolormap","_maintex"].map(name => maps.find(m => m.key.name.toLowerCase() === name && m.file)).find(Boolean);
    return diffusePreview(await this.texture(main?.file), doc);
  }

  async objTextures(file, model, object, catalog) {
    const textures = new Map();
    if (!file?.rel) return textures;
    const used = new Set(object.faces.map(f => f.material).filter(Boolean));
    for (const library of model.libraries) {
      const mtl = catalog.assets.get(normalize(path.join(path.dirname(file.rel), library)))?.[0]?.file;
      if (!mtl) continue;
      const text = await fs.readFile(mtl.full, "utf8").catch(() => "");
      let name;
      for (const raw of text.split(/\r\n|\r|\n/)) {
        const line = raw.split("#", 1)[0].trim();
        if (/^newmtl\s/.test(line)) name = line.slice(6).trim();
        if (!used.has(name) || !/^map_Kd\s/i.test(line)) continue;
        const rel = path.join(path.dirname(mtl.rel), normalize(line.slice(6).trim()));
        const map = catalog.assets.get(normalize(rel))?.[0]?.file;
        const texture = await this.texture(map);
        if (texture) textures.set(name, texture);
      }
    }
    return textures;
  }
}

export { Materials, diffusePreview, escape, imageMarkdown, resize };
