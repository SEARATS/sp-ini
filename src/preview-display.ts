import { Mesh, type Object3D } from "three";
import { isColliderName } from "./mesh-names";

export interface DisplaySettings {
  meshes: boolean;
  colliders: boolean;
  wireframe: boolean;
}

export function applyDisplay(model: Object3D, categories: Map<string, boolean>, hidden: Set<string>, settings: DisplaySettings) {
  model.traverse(node => {
    if (!("geometry" in node)) return;
    const id = node.userData.partId ?? String((node as Object3D & {ID?: number}).ID);
    const collider = categories.get(id) ?? isColliderName(node.userData.originalName || node.name);
    // Layers hide this drawable while leaving child meshes independently visible.
    if ((collider ? settings.colliders : settings.meshes) && !hidden.has(id)) node.layers.enable(0);
    else node.layers.disable(0);
    if (node instanceof Mesh) {
      for (const material of [node.material].flat())
        if ("wireframe" in material) material.wireframe = settings.wireframe;
    }
  });
}
