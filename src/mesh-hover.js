const { PNG } = require("pngjs");
const { escape, imageMarkdown } = require("./materials");

// Use only the selected object's geometry; OBJ face indices are global to the file.
function thumbnail(model, obj, textures) {
  const indices = obj.faces.length ? new Set(obj.faces.flatMap(f => f.indices)) :
    new Set(Array.from({ length: obj.vertexCount }, (_, i) => obj.firstVertex + i));
  const points = new Map();
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const i of indices) {
    const p = model.vertices[i];
    if (!p) continue;
    const [x, y, z] = p;
    const u = (x - z) * 0.7071, v = (x + z) * 0.32 - y * 0.89;
    points.set(i, [u, v, (x + z) * 0.63 + y * 0.45]);
    left = Math.min(left, u); right = Math.max(right, u);
    top = Math.min(top, v); bottom = Math.max(bottom, v);
  }
  if (!points.size) return {};
  const width = 332, height = 202;
  const image = new PNG({ width, height });
  const scale = Math.min((width - 12) / (right - left || 1e-8), (height - 12) / (bottom - top || 1e-8));
  for (const point of points.values()) {
    point[0] = Math.round(width / 2 + (point[0] - (left + right) / 2) * scale);
    point[1] = Math.round(height / 2 + (point[1] - (top + bottom) / 2) * scale);
  }
  const textured = new PNG({ width, height });
  if (textures.size) {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const background = ((x >> 3) + (y >> 3)) % 2 ? 0xb9bdc1ff : 0xc3c7cbff;
      textured.data.writeUInt32BE(background, 4 * (y * width + x));
    }
  }
  const depth = new Float64Array(width * height).fill(-Infinity);
  let sampled = false;
  const ink = (x, y) => image.data.writeUInt32BE(0x739cbfff, (y * width + x) * 4);
  for (const p of points.values()) ink(...p);
  for (const face of obj.faces) {
    const { indices, texcoords, material } = face;
    const texture = textures.get("") || textures.get(material);
    for (let j = 0; j < indices.length; j++) {
      const a = points.get(indices[j]), b = points.get(indices[(j + 1) % indices.length]);
      if (!a || !b) continue;
      const dx = b[0] - a[0], dy = b[1] - a[1], steps = Math.max(Math.abs(dx), Math.abs(dy));
      for (let k = 1; k < steps; k++) ink(Math.round(a[0] + dx * k / steps), Math.round(a[1] + dy * k / steps));
    }
    if (!texture) continue;
    for (let j = 1; j + 1 < indices.length; j++) {
      const corners = [0, j, j + 1];
      const tri = corners.map(k => points.get(indices[k]));
      const uv = corners.map(k => model.uvs[texcoords[k]]);
      if (tri.every(Boolean) && uv.every(Boolean)) {
        sampled = true;
        paintTriangle(textured, depth, tri, uv, texture);
      }
    }
  }
  return { image, textured: sampled && textured };
}

function paintTriangle(image, depth, [a, b, c], [ta, tb, tc], texture) {
  const area = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  // OBJ front faces are counterclockwise. Screen Y grows downwards.
  if (area >= 0) return;
  for (let y = Math.min(a[1], b[1], c[1]); y <= Math.max(a[1], b[1], c[1]); y++) {
    for (let x = Math.min(a[0], b[0], c[0]); x <= Math.max(a[0], b[0], c[0]); x++) {
      const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / area;
      const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / area;
      const w = 1 - u - v;
      if (Math.min(u, v, w) < 0) continue;
      const z = u * a[2] + v * b[2] + w * c[2], i = y * image.width + x;
      if (z < depth[i]) continue;
      const sx = u * ta[0] + v * tb[0] + w * tc[0];
      const sy = u * ta[1] + v * tb[1] + w * tc[1];
      const col = Math.floor((sx - Math.floor(sx)) * texture.width);
      const row = texture.height - 1 - Math.floor((sy - Math.floor(sy)) * texture.height);
      const pixel = texture.data.readUInt32BE((row * texture.width + col) * 4);
      if ((pixel & 255) === 0) continue;
      depth[i] = z;
      image.data.writeUInt32BE(pixel, i * 4);
    }
  }
}

function meshHover(model, object, textures = new Map()) {
  const { image, textured } = thumbnail(model, object, textures);
  const label = escape(object.name);
  const title = "**" + label + "** · " + object.faces.length + (object.faces.length === 1 ? " face" : " faces");
  const wire = image ? imageMarkdown("Object wireframe", image) : "";
  const body = textured ? "| Wireframe | Textured |\n| --- | --- |\n| " + wire + " | " + imageMarkdown("Textured object", textured) + " |" :
    wire + "\n\nNo previewable diffuse texture or UV mapping.";
  return { contents: { kind: "markdown", value: title + "\n\n" + body } };
}

module.exports = { meshHover, thumbnail };
