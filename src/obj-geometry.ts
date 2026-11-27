import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { Mesh, MeshPhongMaterial } from "three";
import { objLayout } from "./model-outline";

export function previewObj(source: string, layout = objLayout(source)) {
  const model = new OBJLoader().parse(layout.text);
  const originals = new Set<MeshPhongMaterial>();
  model.traverse(node => {
    const block = node.name && layout.parts[Number(node.name)];
    if (block) {
      node.name = block.name;
      node.userData.partId = block.part.id;
    }
    if (!(node instanceof Mesh)) return;
    // OBJLoader shares materials across objects. Each part can change type while open.
    const copyMaterial = (source: MeshPhongMaterial) => {
      originals.add(source);
      const copy = source.clone();
      copy.userData.objBaseColor = source.color.getHex();
      if (block?.part.collider) copy.color.setHex(0xff833d);
      return copy;
    };
    node.material = Array.isArray(node.material) ? node.material.map(copyMaterial) : copyMaterial(node.material);
  });
  for (const original of originals) original.dispose();
  return model;
}
