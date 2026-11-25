import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { Mesh, MeshPhongMaterial } from "three";
import { isColliderName } from "./mesh-names";

export function previewObj(source: string) {
  // OBJLoader starts a new drawable for both "o" and "g". Carry the object's tag into its groups.
  let owner = "";
  const text = source.replace(/^[ \t]*([og])[ \t]+([^\r\n]*)/gm, (line, kind, label) => {
    const name = label.split("#",1)[0].trim();
    if (kind === "o") owner = name;
    return kind === "g" && isColliderName(owner) ? "g " + owner : line;
  });
  const model = new OBJLoader().parse(text);
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
    if (!(node instanceof Mesh)) return;
    if (isColliderName(node.name)) node.material = Array.isArray(node.material) ? node.material.map(tint) : tint(node.material);
    else [node.material].flat().forEach(m=>used.add(m));
  });
  for (const original of assigned.keys()) if (!used.has(original)) original.dispose();
  return model;
}
