import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { Mesh, MeshPhongMaterial } from "three";
import { objLayout } from "./model-outline";

export function previewObj(source: string, layout = objLayout(source)) {
  const model = new OBJLoader().parse(layout.text);
  const assigned = new Map<MeshPhongMaterial,MeshPhongMaterial>();
  const used = new Set<MeshPhongMaterial>();
  const tint = (material: MeshPhongMaterial) => {
    if (!assigned.has(material)) {
      const copy = material.clone();
      copy.color.setHex(0xff833d);
      assigned.set(material,copy);
    }
    return assigned.get(material);
  };
  model.traverse(node => {
    const block = node.name && layout.parts[Number(node.name)];
    if (block) {
      node.name = block.name;
      node.userData.partId = block.part.id;
    }
    if (!(node instanceof Mesh)) return;
    if (block?.part.collider) node.material = Array.isArray(node.material) ? node.material.map(tint) : tint(node.material);
    else [node.material].flat().forEach(m=>used.add(m));
  });
  for (const original of assigned.keys()) if (!used.has(original)) original.dispose();
  return model;
}
