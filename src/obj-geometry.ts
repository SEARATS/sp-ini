import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { Mesh, MeshPhongMaterial, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader, type Group, type LoadingManager } from "three";
import { localAssetUrl } from "./missing-textures";
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

export async function loadObjDiffuseMaps(model: Group, modelUrl: string, manager: LoadingManager) {
  const libraries = (model as Group & {materialLibraries?: string[]}).materialLibraries ?? [];
  const loader = new TextureLoader(manager);
  const parser = new MTLLoader();
  for (const library of new Set(libraries)) {
    const url = localAssetUrl(library, modelUrl);
    if (!url) continue;
    let text: string;
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      text = await response.text();
    } catch { continue; }
    const mtl = parser.parse(text, new URL(".", url).href);
    model.traverse(node => {
      if (!(node instanceof Mesh)) return;
      for (const material of [node.material].flat()) {
        const map = mtl.materialsInfo[material.name]?.map_kd;
        if (!map || material.map) continue;
        const params = mtl.getTextureParams(map, {});
        const source = localAssetUrl(params.url, url);
        const texture = source ? loader.load(source) : new Texture();
        texture.colorSpace = SRGBColorSpace;
        texture.wrapS = texture.wrapT = RepeatWrapping;
        texture.repeat.copy(params.scale);
        texture.offset.copy(params.offset);
        material.map = texture;
        material.needsUpdate = true;
      }
    });
  }
}
