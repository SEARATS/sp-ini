import * as fs from "node:fs/promises";
import { posix as path } from "node:path";
import { PNG } from "pngjs";
import * as jpeg from "jpeg-js";
import { parse } from "./ini";
import { normalize } from "./catalog";
import { reference, referenceContext } from "./references";
import { materialSwatch } from "./material-swatch";

const escape = text => text.replace(/[^\p{L}\p{N} _-]/gu, ch => "\\" + ch);
function imageMarkdown(name, image, budget = 42000) {
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
      if (encoded.length * 4 / 3 <= budget) return "![" + name + "](data:image/jpeg;base64," + encoded.toString("base64") + ")";
    }
  }
  // VS Code truncates long Markdown blocks, including data URLs inside them.
  while (png.length * 4 / 3 > budget && Math.max(image.width, image.height) > 1) {
    image = resize(image, Math.max(1, Math.floor(Math.max(image.width, image.height) * 0.8)));
    png = PNG.sync.write(image);
  }
  return "![" + name + "](data:image/png;base64," + png.toString("base64") + ")";
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

  async texture(file) {
    if (!file || !/\.(png|jpe?g)$/i.test(file.rel)) return;
    const stat = await fs.stat(file.full).catch(() => null);
    if (!stat || stat.size > 96 * 1024 * 1024) return;
    const old = this.cache.get(file.uri);
    if (old?.stamp === stat.mtimeMs && old.size === stat.size) return old.image;
    let image;
    try {
      const bytes = await fs.readFile(file.full);
      const png = /\.png$/i.test(file.rel);
      if (png && bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 32 * 1024 * 1024) return;
      const source = png ? PNG.sync.read(bytes) : jpeg.decode(bytes, { maxResolutionInMP: 32, maxMemoryUsageInMB: 256 });
      image = resize(source, 384);
    } catch { return; }
    if (this.cache.size >= 24) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(file.uri, { stamp: stat.mtimeMs, size: stat.size, image });
    return image;
  }

  materialFile(entry, doc, uri, catalog) {
    if (!entry || !/^(resourcesmaterial|material)$/i.test(entry.name)) return;
    const ctx = referenceContext(doc, uri, catalog);
    ctx.resources = entry.section.keys.find(k => /^resourcesmaterialfolder$/i.test(k.name))?.value || ctx.resources;
    return reference(entry, /\.ini$/i.test(entry.value) ? entry.value : entry.value + '.ini', ctx).refs[0]?.file ||
      (!/\.ini$/i.test(entry.value) && reference(entry,entry.value,ctx).refs.find(r=>/\.mat$/i.test(r.file?.rel))?.file);
  }

  maps(file, catalog, doc) {
    if (!doc) return [];
    const ctx = referenceContext(doc, file.uri, catalog);
    return (doc.sections.find(s => /^textures$/i.test(s.name))?.keys || []).map(key => ({
      key, file: reference(key, key.value, ctx).refs[0]?.file
    }));
  }

  async materialData(file,catalog) {
    if (!/\.mat$/i.test(file.rel)) {
      const doc = await this.readIni(file);
      return {doc,maps:this.maps(file,catalog,doc)};
    }
    const yaml = await fs.readFile(file.full,"utf8");
    const props = yaml.split(/\bm_Floats:/)[1]?.split(/\bm_Colors:/)[0] || "";
    const doc = parse("[Properties]\n"+[...props.matchAll(/^\s*(_\w+):\s*([\d.e+-]+)\s*$/gmi)].map(m=>m[1]+"="+m[2]).join("\n"));
    const maps = [...yaml.matchAll(/^\s*(_\w+):\s*\r?\n\s*m_Texture:.*?guid: ([0-9a-f]+)/gmi)].map(m=>{
      const file = catalog.mirrorTextures.get(m[2]);
      return {key:{name:m[1],value:file?.rel || m[2]},file};
    });
    return {doc,maps};
  }

  async hover(file, catalog, images = true) {

    const {doc,maps} = await this.materialData(file,catalog);
    if (!images) return { contents: { kind: "plaintext" as const, value: [file.rel, ...maps.map(m => m.key.name + "=" + m.key.value)].join("\n") } };
    const textures = new Map();
    for (const map of maps) textures.set(map.key.name.toLowerCase(), await this.texture(map.file));
    return this.render(file.rel, doc, maps, textures);
  }

  render(name, doc, maps, textures) {
    const parts = ["**" + escape(path.basename(name)) + "**"];
    const props = doc?.sections.find(s => /^properties$/i.test(s.name))?.keys || [];
    const swatch = materialSwatch(textures, new Map(props.map(k => [k.name.toLowerCase(), k.value])));
    const budget = Math.floor(84000 / (maps.length + 1));
    for (let i = 0; i < maps.length; i += 3) {
      const group = maps.slice(i, i + 3);
      const labels = group.map(m => escape(m.key.name));
      const previews = [];
      if (!i && swatch) {
        labels.unshift("Lit material");
        previews.push(imageMarkdown("Lit material", swatch, budget));
      }
      for (const map of group) {
        const raw = textures.get(map.key.name.toLowerCase());
        const image = /^_maintex$/i.test(map.key.name) ? diffusePreview(raw, doc) : raw;
        previews.push(image ? imageMarkdown("Texture", resize(image, 144), budget) : map.file ? "Preview unavailable" : "File missing");
      }
      parts.push([labels, labels.map(() => "---"), previews]
        .map(row => "| " + row.join(" | ") + " |").join("\n"));
    }
    if (maps.length) parts.push(maps.map(m => escape(m.key.name) + " � " + escape(path.basename(m.key.value))).join("  \n"));
    return { contents: { kind: "markdown" as const, value: parts.join("\n\n") } };
  }

  async diffuse(file, catalog) {
    const {doc,maps} = await this.materialData(file,catalog);
    const main = maps.find(m => /^_maintex$/i.test(m.key.name));
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

export { Materials, diffusePreview, escape, imageMarkdown };
