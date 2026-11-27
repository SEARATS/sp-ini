import { BufferAttribute, BufferGeometry, Color, Group, LoadingManager, Matrix4, Mesh, MeshPhongMaterial, SRGBColorSpace, TextureLoader } from "three";
import type { FbxScene } from "./fbx-reader";
import { localAssetUrl } from "./missing-textures";

export function fbxBasis(axes: number[]) {
  const matrix = new Matrix4();
  if (axes.some(axis => axis < 0 || axis > 5) || new Set(axes.map(axis => axis >> 1)).size !== 3) return matrix;
  matrix.elements.fill(0);
  matrix.elements[15] = 1;
  axes.forEach((axis, row) => { matrix.elements[(axis >> 1)*4 + row] = axis % 2 ? -1 : 1; });
  return matrix;
}

export function previewFbx(scene: FbxScene, base: string, manager: LoadingManager) {
  const loader = new TextureLoader(manager);
  const materials = scene.materials.map(source => {
    const material = new MeshPhongMaterial({name: source.name, color: new Color().fromArray(source.color)});
    let url: string;
    if (source.content?.length) url = URL.createObjectURL(new Blob([Uint8Array.from(source.content)]));
    else if (source.path) url = localAssetUrl(source.path, base);
    if (url) {
      const release = () => { if (source.content?.length) URL.revokeObjectURL(url); };
      material.map = loader.load(url, release, undefined, release);
      material.map.colorSpace = SRGBColorSpace;
    } else if (source.path) material.userData.missingDiffuse = true;
    return material;
  });
  const fallback = new MeshPhongMaterial({color: 0xcccccc});
  const geometries = scene.meshes.map(source => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(source.positions, 3));
    geometry.setAttribute("normal", new BufferAttribute(source.normals, 3));
    if (source.uvs.length) geometry.setAttribute("uv", new BufferAttribute(source.uvs, 2));
    geometry.setIndex(new BufferAttribute(source.indices, 1));
    for (let start = 0; start < source.slots.length;) {
      let end = start + 1;
      while (end < source.slots.length && source.slots[end] === source.slots[start]) end++;
      geometry.addGroup(start*3, (end-start)*3, source.slots[start]);
      start = end;
    }
    return geometry;
  });
  const root = new Group(), axes = new Group();
  axes.matrix.copy(fbxBasis(scene.axes));
  axes.matrixAutoUpdate = false;
  root.add(axes);
  const nodes = new Map(scene.nodes.map(source => {
    const group = new Group();
    group.name = source.name;
    group.matrix.fromArray(source.local);
    group.matrixAutoUpdate = false;
    if (source.mesh >= 0) {
      const slots = source.materials.map(i => materials[i] ?? fallback);
      const part = new Mesh(geometries[source.mesh], slots.length ? slots : fallback);
      part.name = source.name;
      part.userData.partId = source.id;
      part.matrix.fromArray(source.geometric);
      part.matrixAutoUpdate = false;
      group.add(part);
    }
    return [source.index, group];
  }));
  for (const source of scene.nodes) (nodes.get(source.parent) ?? axes).add(nodes.get(source.index));
  return root;
}
