import { Mesh, type Color, type Material, type Object3D } from "three";
import { isColliderName } from "./mesh-names";
import { missingTextureColors, type MissingTextureColor } from "./missing-textures";

export const previewLayer = { mesh:0, collider:1, widget:2, highlight:3, arc:4, route:5 } as const;

export interface DisplaySettings {
  meshes: boolean;
  colliders: boolean;
  objects?: boolean;
  arcs?: boolean;
  taxiPaths?: boolean;
  airPaths?: boolean;
  meshWireframe: boolean;
  colliderWireframe: boolean;
  missingTextureColor?: MissingTextureColor;
}

export function applyDisplay(model: Object3D, categories: Map<string, boolean>, hidden: Set<string>, settings: DisplaySettings) {
  const used = new Set<Material>();
  const alternate = new Map<Material, Material>();
  function styled(material: Material, wireframe: boolean, collider: boolean) {
    if (!("wireframe" in material)) return material;
    if ("color" in material) {
      const base = material.userData.objBaseColor;
      const color = collider && base !== undefined ? 0xff833d : material.userData.missingDiffuse
        ? missingTextureColors[settings.missingTextureColor ?? "grey"] : base;
      if (color !== undefined) (material.color as Color).setHex(color);
    }
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
    const widget = node.userData.widget;
    const hasVisibleCollider = widget && settings.colliders && node.userData.colliderIds?.some((partId:string)=>!hidden.has(partId));
    const visible = node.userData.routeKind ? settings[node.userData.routeKind] :
      widget ? settings.objects && !hasVisibleCollider : collider ? settings.colliders : settings.meshes;
    // A parent's layer does not hide its children.
    if (visible && !hidden.has(id)) node.layers.set(node.userData.routeKind ? previewLayer.route :
      widget ? previewLayer.widget : collider ? previewLayer.collider : previewLayer.mesh);
    else node.layers.disableAll();
    if (!widget && node instanceof Mesh) {
      const wireframe = collider ? settings.colliderWireframe : settings.meshWireframe;
      node.material = Array.isArray(node.material) ? node.material.map(m => styled(m, wireframe, collider)) : styled(node.material, wireframe, collider);
    }
  });
}
