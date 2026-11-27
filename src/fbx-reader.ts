import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomFillSync } from "node:crypto";

export function needsFbxReader(bytes: Buffer) {
  if (bytes.subarray(0, 18).toString() === "Kaydara FBX Binary")
    return bytes.length < 27 || bytes[22] !== 0 || bytes.readUInt32LE(23) < 7000;
  const header = bytes.toString("utf8", 0, 16384);
  const version = /\bFBXVersion:\s*(\d+)/.exec(header);
  return version ? Number(version[1]) < 7000 : /;\s*FBX\s+[1-6]\.|\bModel:\s*"Model::/i.test(header);
}

export interface FbxScene {
  axes: number[];
  nodes: {index: number; parent: number; id: string; name: string; mesh: number; local: number[]; geometric: number[]; materials: number[]}[];
  meshes: {name: string; positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array; slots: Uint32Array; faces?: [number, number][]; vertexIndices?: Uint32Array}[];
  materials: {name: string; color: number[]; path: string; content?: Uint8Array}[];
}

interface ReaderExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  _initialize(): void;
  malloc(n: number): number;
  free(ptr: number): void;
  decode(ptr: number, n: number, geometry: number, originalIds: number): number;
}

let compiled: WebAssembly.Module;
export function readFbx(bytes: Buffer, mode: "preview" | "hierarchy" | "lookup" = "preview"): FbxScene {
  if (!compiled) {
    const file = [__dirname, join(__dirname, "../dist"), join(__dirname, "..")]
      .map(dir => join(dir, "fbx-reader.wasm")).find(existsSync);
    if (!file) throw Error("The bundled FBX reader is missing.");
    compiled = new WebAssembly.Module(Uint8Array.from(readFileSync(file)));
  }
  const scene: FbxScene = {axes: [], nodes: [], meshes: [], materials: []};
  let wasm: ReaderExports, error = "Insufficient memory reading FBX.";
  const memory = () => wasm.memory.buffer;
  const text = (ptr: number, len: number) => Buffer.from(memory(), ptr, len).toString("utf8");
  function string(ptr: number) {
    if (!ptr) return "";
    const [start, length] = new Uint32Array(memory(), ptr, 2);
    return text(start, length);
  }
  const floats = (ptr: number, len: number) => new Float32Array(memory(), ptr, len).slice();
  const ints = (ptr: number, len: number) => new Uint32Array(memory(), ptr, len).slice();
  function matrix(ptr: number) {
    const m = new Float64Array(memory(), ptr, 12);
    return [m[0],m[1],m[2],0, m[3],m[4],m[5],0, m[6],m[7],m[8],0, m[9],m[10],m[11],1];
  }
  const nodes = new Map<number, FbxScene["nodes"][number]>();
  const fbx = {
    error(ptr: number, len: number) { error = text(ptr, len); },
    axes(right: number, up: number, front: number) { scene.axes = [right, up, front]; },
    node(index: number, parent: number, id: bigint, name: number, mesh: number, local: number, geometric: number) {
      const node = {index, parent, id: String(id), name: string(name), mesh, local: matrix(local), geometric: matrix(geometric), materials: []};
      scene.nodes.push(node);
      nodes.set(index, node);
    },
    binding(index: number, material: number) { nodes.get(index).materials.push(material); },
    material(name: number, color: number, path: number, content: number, size: number) {
      scene.materials.push({name: string(name), color: Array.from(new Float64Array(memory(), color, 3)), path: string(path),
        content: size ? new Uint8Array(memory(), content, size).slice() : undefined});
    },
    mesh(name: number, n: number, positions: number, normals: number, uv: number, triangles: number, indices: number, slots: number) {
      scene.meshes.push({name: string(name), positions: floats(positions, n*3), normals: floats(normals, n*3),
        uvs: floats(uv, uv ? n*2 : 0), indices: ints(indices, triangles*3), slots: ints(slots, triangles)});
    },
    polygons(name: number, n: number, positions: number, corners: number, vertexIndices: number, uv: number, count: number, ranges: number) {
      const pairs = new Uint32Array(memory(), ranges, count*2);
      scene.meshes.push({name: string(name), positions: Float32Array.from(new Float64Array(memory(), positions, n*3)),
        normals: new Float32Array(), uvs: floats(uv, uv ? corners*2 : 0), indices: new Uint32Array(), slots: new Uint32Array(),
        faces: Array.from({length:count}, (_,i)=>[pairs[2*i], pairs[2*i+1]]), vertexIndices: ints(vertexIndices, corners)});
    }
  };
  wasm = new WebAssembly.Instance(compiled, {fbx, wasi_snapshot_preview1: {
    random_get(ptr: number, len: number) { randomFillSync(new Uint8Array(memory(), ptr, len)); return 0; }
  }}).exports as ReaderExports;
  wasm._initialize();
  const ptr = wasm.malloc(bytes.length);
  if (!ptr) throw Error(error);
  try {
    new Uint8Array(memory(), ptr, bytes.length).set(bytes);
    if (!wasm.decode(ptr, bytes.length, {hierarchy:0, preview:1, lookup:2}[mode], Number(mode !== "lookup" && !needsFbxReader(bytes)))) throw Error(error);
    return scene;
  } finally { wasm.free(ptr); }
}
