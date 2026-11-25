import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { stat } from "node:fs/promises";
import * as path from "node:path";
import { PNG } from "pngjs";
import { parse, IniEntry } from "./ini";
import { Materials, diffusePreview, imageMarkdown } from "./materials";
import { parseObj } from "./meshes";
import { meshHover } from "./mesh-hover";

type StockImage = { name: string, png: string };
type StockMaterial = { shader: string, floats: Record<string,number>, maps: Record<string, StockImage> };
type StockTypes = { Mesh: {obj: string}, Material: StockMaterial, Texture2D: StockImage };

export class StockAssets {
  directory?: string;
  private stamp = "";
  private process?: ChildProcessWithoutNullStreams;
  private id = 0;
  private pending = new Map<number, (value: unknown) => void>();
  private cache = new Map<string, Promise<unknown>>();

  close() {
    this.process?.kill();
    this.process = undefined;
    this.pending.forEach(resolve => resolve(undefined));
    this.pending.clear();
    this.cache.clear();
  }

  private start(directory: string) {
    const child = spawn(path.join(__dirname, "stock-reader", process.platform === "win32" ? "stock-reader.exe" : "stock-reader"),
      [directory], {windowsHide: true, stdio: "pipe"});
    this.process = child;
    const stop = () => { if (child === this.process) this.close(); };
    child.on("error", stop);
    child.on("exit", stop);
    child.stdin.on("error", stop);
    child.stderr.resume();
    createInterface({input: child.stdout}).on("line", line => {
      if (child !== this.process) return;
      try {
        const {id, value} = JSON.parse(line);
        this.pending.get(id)?.(value);
        this.pending.delete(id);
      } catch { stop(); }
    });
    return child;
  }

  async read<K extends keyof StockTypes>(kind: K, name: string, scope: string): Promise<StockTypes[K] | undefined> {
    const directory = this.directory;
    if (!directory || !name || /[\r\n]/.test(name)) return;
    const stamps = await Promise.all(["resources.assets", "resources.assets.resS", "globalgamemanagers"].map(async file => {
      const s = await stat(path.join(directory,file)).catch(() => undefined);
      return s && [s.mtimeMs,s.size].join("/");
    }));
    if (!stamps[0] || this.directory !== directory) return;
    const stamp = [directory,...stamps].join("|");
    if (stamp !== this.stamp) { this.close(); this.stamp = stamp; }
    const key = JSON.stringify([kind,name,scope]);
    if (!this.cache.has(key)) {
      const child = this.process || this.start(directory);
      const id = ++this.id;
      const result = new Promise<unknown>(resolve => {
        const timer = setTimeout(() => { if (this.process === child) this.close(); }, 90000);
        this.pending.set(id, value => { clearTimeout(timer); resolve(value); });
        child.stdin.write(JSON.stringify({id, kind, name, scope}) + "\n");
      });
      if (this.cache.size >= 18) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key, result);
    }
    return await this.cache.get(key) as StockTypes[K];
  }
}

const decode = (image: StockImage) => PNG.sync.read(Buffer.from(image.png, "base64"));
const field = (section, name: string) => section?.keys.find(k => k.name.toLowerCase() === name)?.value;
const materialDoc = (m: StockMaterial) => parse(["[Shader]", "Path=" + m.shader, "[Properties]",
  ...Object.entries(m.floats).map(([k,v]) => k+"="+v)].join("\n"));

export async function stockDiffuse(stock: StockAssets, name: string, scope: string) {
  const m = await stock.read("Material",name,scope);
  if (m?.maps._MainTex) return diffusePreview(decode(m.maps._MainTex),materialDoc(m));
}

export async function stockHover(stock: StockAssets, materials: Materials, doc: ReturnType<typeof parse>, uri: string,
    entry: IniEntry, catalog, images: boolean, mesh = false) {
  if (!entry?.value || /\.(ini|obj|fbx|png|jpe?g)$/i.test(entry.value)) return;
  const models = doc.sections.find(s => /^models$/i.test(s.name));
  const folder = field(models,"resourcesfolder") || "";
  const root = field(entry.section,"rootmesh") || field(models,"resourcesroot");
  const matKey = /^resourcesmesh$/i.test(entry.name) ? "resourcesmaterial" : "material";
  const matEntry = mesh ? entry.section?.keys.find(k => k.name.toLowerCase() === matKey) : entry;
  const matName = matEntry?.value;
  const matScope = path.posix.join(field(entry.section,"resourcesmaterialfolder") || folder, matName || "");
  if (mesh) {
    if (!root || /\.(fbx|obj)$/i.test(root)) return;
    const asset = await stock.read("Mesh",entry.value,path.posix.join(field(entry.section,"resourcesmeshfolder") || folder,root));
    if (!asset) return;
    const model = parseObj(asset.obj), obj = model.objects[0];
    if (!obj) return;
    if (!images) return {contents:{kind:"plaintext" as const,value:obj.name + " · " + obj.faces.length + " faces"}};
    const textures = new Map();
    const loose = materials.materialFile(matEntry,doc,uri,catalog);
    if (loose) textures.set("",await materials.diffuse(loose,catalog));
    else if (matName && !/\.ini$/i.test(matName)) {
      const image = await stockDiffuse(stock,matName,matScope);
      if (image) textures.set("",image);
    }
    return meshHover(model,obj,textures);
  }
  if (/^(resourcesmaterial|material)$/i.test(entry.name)) {
    const m = await stock.read("Material",matName,matScope);
    if (!m) return;
    const maps = Object.entries(m.maps).map(([name,image]) => ({key:{name,value:image.name}}));
    if (!images) return {contents:{kind:"plaintext" as const,value:[matName,...maps.map(v=>v.key.value)].join("\n")}};
    return materials.render(matName, materialDoc(m), maps,
      new Map(Object.entries(m.maps).map(([k,image]) => [k.toLowerCase(),decode(image)])));
  }
  if (images && /^textures$/i.test(entry.section?.name)) {
    const asset = await stock.read("Texture2D",path.posix.basename(entry.value),entry.value);
    if (asset) return {contents:{kind:"markdown" as const,value:imageMarkdown("Texture",decode(asset))}};
  }
}
