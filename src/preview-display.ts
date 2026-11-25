import { Mesh, type Material, type Object3D } from "three";
import { isColliderName } from "./mesh-names";

export interface DisplaySettings {
  meshes: boolean;
  colliders: boolean;
  meshWireframe: boolean;
  colliderWireframe: boolean;
}

export function applyDisplay(model: Object3D, categories: Map<string, boolean>, hidden: Set<string>, settings: DisplaySettings) {
  const used = new Set<Material>();
  const alternate = new Map<Material, Material>();
  function styled(material: Material, wireframe: boolean) {
    if (!("wireframe" in material)) return material;
    // An FBX may assign the same material to a visible surface and its collider.
    if (used.has(material) && material.wireframe !== wireframe) {
      if (!alternate.has(material)) alternate.set(material, Object.assign(material.clone(), {wireframe}));
      return alternate.get(material);
    }
    material.wireframe = wireframe;
    used.add(material);
    return material;
  }
  model.traverse(node => {
    if (!("geometry" in node)) return;
    const id = node.userData.partId ?? String((node as Object3D & {ID?: number}).ID);
    const collider = categories.get(id) ?? isColliderName(node.userData.originalName || node.name);
    // Layers hide this drawable while leaving child meshes independently visible.
    if ((collider ? settings.colliders : settings.meshes) && !hidden.has(id)) node.layers.enable(0);
    else node.layers.disable(0);
    if (node instanceof Mesh) {
      const wireframe = collider ? settings.colliderWireframe : settings.meshWireframe;
      node.material = Array.isArray(node.material) ? node.material.map(m => styled(m, wireframe)) : styled(node.material, wireframe);
    }
  });
}
