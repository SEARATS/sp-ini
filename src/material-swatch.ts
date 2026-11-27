import { PNG } from "pngjs";

function setting(props, name, fallback) {
  const value = props.get(name)?.split(",").at(-1).trim();
  if (value && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function color(props, name, fallback) {
  const hex = props.get(name)?.match(/(?:\{\*\}|#)([\da-f]{6})([\da-f]{2})?$/i);
  return hex ? hex[1].match(/../g).map(s => parseInt(s, 16) / 255) : fallback;
}

function sample(map, u, v) {
  if (!map) return;
  const x = Math.min(map.width - 1, Math.floor(u * map.width));
  const y = Math.min(map.height - 1, Math.floor(v * map.height));
  return map.data.subarray((y * map.width + x) * 4, (y * map.width + x) * 4 + 4);
}

// Preview the common material slots in tangent space on a front-facing plane covering the entire UV map.
function materialSwatch(textures, props = new Map()) {
  const albedo = textures.get("_basemap") || textures.get("_basecolormap") || textures.get("_maintex"), normal = textures.get("_bumpmap") || textures.get("_normalmap");
  const spec = textures.get("_spectex") || textures.get("_specglossmap");
  const metal = textures.get("_metallicglossmap"), ao = textures.get("_occlusionmap");
  const glow = textures.get("_emissionmap") || textures.get("_emissiontex");
  const reference = albedo || normal || spec || metal || ao || glow;
  if (!reference && !props.has("_color") && !props.has("_basecolor")) return;
  const tint = color(props, "_basecolor", color(props, "_color", [1, 1, 1])), specColor = color(props, "_speccolor", [1, 1, 1]);
  const emission = color(props, "_emissioncolor", [1, 1, 1]);
  const intensity = Math.max(0, setting(props, "_specint", 0.4));
  const gloss = Math.min(1, Math.max(0, setting(props, "_smoothness", setting(props, "_glossiness", setting(props, "_shininess", 0.35)))));
  const packedNormal = normal && normal.data.every((value, i) => i % 4 !== 0 || value === 255) &&
    normal.data.some((value, i) => i % 4 === 3 && value !== 255);
  const {width,height} = reference ?? {width:300,height:178};
  const scale = Math.min(300 / width, 178 / height);
  const image = new PNG({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) });
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const u = (x + 0.5) / image.width, v = (y + 0.5) / image.height;
    const base = sample(albedo, u, v) || [255, 255, 255, 255];
    let dx = 0, dy = 0, dz = 1;
    const bump = sample(normal, u, v);
    if (bump) {
      dx = bump[packedNormal ? 3 : 0] / 127.5 - 1;
      dy = bump[1] / 127.5 - 1;
      dz = packedNormal ? Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy)) : bump[2] / 127.5 - 1;
      const length = Math.hypot(dx, dy, dz) || 1;
      dx /= length; dy /= length; dz /= length;
    }
    const specular = sample(spec, u, v), metallic = sample(metal, u, v);
    const occlusion = (sample(ao, u, v)?.[1] ?? 255) / 255;
    const emissive = sample(glow, u, v);
    const light = Math.max(0, -0.45 * dx + 0.60 * dy + 0.66 * dz);
    const halfAngle = Math.max(0, -0.247 * dx + 0.329 * dy + 0.911 * dz);
    const highlight = intensity * Math.pow(Math.min(1, halfAngle), 4 + 92 * (metallic ? metallic[3] / 255 : gloss));
    const offset = (y * image.width + x) * 4;
    for (let i = 0; i < 3; i++) {
      const shine = specular?.[i] ?? (metallic ? 12 + metallic[0] / 255 * base[i] : 96);
      image.data[offset + i] = Math.min(255, Math.round(base[i] * tint[i] * (0.28 * occlusion + 0.90 * light) +
        shine * specColor[i] * highlight + (emissive?.[i] || 0) * emission[i]));
    }
    image.data[offset + 3] = 255;
  }
  return image;
}

export { materialSwatch };
