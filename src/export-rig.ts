import type { EntityScene } from "./entity-model";
import { fbxGeometry } from "./fbx-geometry";
import { objectHeader, parseObj, triangles } from "./meshes";

export interface RigAssets {
  geometry: EntityScene["geometry"];
  names: [string, number][];
}

export function exportRigAssets(filename: string, bytes: Buffer): RigAssets {
  const text = /\.obj$/i.test(filename) ? bytes.toString("utf8") : undefined;
  const model = text === undefined ? fbxGeometry(bytes) : parseObj(text, !text.split(/\r?\n/).some(line => objectHeader.test(line)));
  const geometry: EntityScene["geometry"] = [], names = new Map<string, number>();
  // FBX object names and geometry names can refer to the same polygon array.
  const indices = new Map<object, number>();
  for (const obj of model.objects) {
    if (names.has(obj.name) || !obj.faces.length) continue;
    let index = indices.get(obj.faces);
    if (index === undefined) {
      const mesh = triangles(model, obj);
      if (!mesh) continue;
      index = geometry.push(mesh) - 1;
      indices.set(obj.faces, index);
    }
    names.set(obj.name, index);
  }
  return {geometry, names:[...names]};
}
