import { Mesh, type Object3D } from "three";

export const missingTextureColors = {black:0x000000, magenta:0xff00ff, grey:0x808080} as const;
export type MissingTextureColor = keyof typeof missingTextureColors;
export const isMissingTextureColor = (value: unknown): value is MissingTextureColor =>
  typeof value === "string" && Object.hasOwn(missingTextureColors, value);

/** Exporters can leave an absolute authoring path behind. Try its filename beside the model. */
export function localAssetUrl(path: string, base: string): string | undefined {
  const normalized = path.replaceAll("\\", "/");
  const file = /^(?:[a-z]:\/|\/)/i.test(normalized) ? normalized.split("/").pop() : normalized;
  if (!file) return;
  try {
    const url = new URL(file, base);
    if (url.origin === new URL(base).origin) return url.href;
  } catch { /* Invalid texture or material library path. */ }
}

/** Call after the loading manager settles, when an empty diffuse map indicates a failed request. */
export function markMissingMaps(model: Object3D) {
  model.traverse(node => {
    if (!(node instanceof Mesh)) return;
    for (const material of [node.material].flat()) {
      if (!material.map || material.map.image) continue;
      material.map.dispose();
      material.map = null;
      material.vertexColors = false;
      material.userData.missingDiffuse = true;
      material.needsUpdate = true;
    }
  });
}
