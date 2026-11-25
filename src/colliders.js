const { tokens } = require("./references");
const { thumbnail } = require("./mesh-hover");
const { escape, imageMarkdown } = require("./materials");

function colliderSection(doc, pos, entry) {
  const list = doc.sections.find(s => /^colliders$/i.test(s.name));
  if (!list) return;
  const names = new Set(list.keys.filter(k => /^(?:mesh)?collider\d+$/i.test(k.name)).map(k => k.value.toLowerCase()));
  let name = doc.sections.find(s => s.line === pos.line)?.name;
  if (entry && /^(?:mesh)?collider\d*$/i.test(entry.name)) {
    const token = tokens(entry.value, entry.valueStart).find(t => t.start <= pos.character && pos.character <= t.end);
    if (token) name = /^(box|sphere)$/i.test(token.name) ? entry.section?.name : token.name;
  }
  if (name && names.has(name.toLowerCase())) return doc.sections.find(s => s.name.toLowerCase() === name.toLowerCase());
}

function primitiveHover(section, images = true) {
  const field = name => section.keys.find(k => k.name.toLowerCase() === name)?.value;
  const type = field("collider") || "Box";
  if (!/^(box|sphere)$/i.test(type)) return;
  const vector = name => (field(name) || "0,0,0").split(",").map(Number);
  const scale = vector("scale"), rotation = vector("rotation");
  const text = "**" + escape(section.name) + "** · " + type + "\n\nScale: " + scale.join(" × ") +
    "  \nPosition: " + vector("position").join(", ") + "  \nRotation: " + rotation.join(", ");
  if (!images) return { contents: { kind: "plaintext", value: text.replaceAll("**", "") } };
  if (![scale, rotation].every(v => v.length === 3 && v.every(Number.isFinite))) return { contents: { kind: "markdown", value: text } };
  const vertices = [], faces = [];
  function loop(points) {
    const indices = points.map(p => {
      let [x, y, z] = p.map((v, i) => v * scale[i] / 2);
      const [rx, ry, rz] = rotation.map(v => v * Math.PI / 180);
      [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
      [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
      return vertices.push([x * Math.cos(ry) + z * Math.sin(ry), y, -x * Math.sin(ry) + z * Math.cos(ry)]) - 1;
    });
    faces.push({ indices });
  }
  if (/^sphere$/i.test(type)) {
    for (let axis = 0; axis < 3; axis++) loop(Array.from({ length: 64 }, (_, i) => {
      const p = [0, 0, 0], angle = Math.PI * i / 32;
      p[(axis + 1) % 3] = Math.cos(angle); p[(axis + 2) % 3] = Math.sin(angle);
      return p;
    }));
  } else {
    for (const side of [-1, 1]) {
      loop([[-1, side, -1], [1, side, -1], [1, side, 1], [-1, side, 1]]);
      loop([[side, -1, -1], [side, 1, -1], [side, 1, 1], [side, -1, 1]]);
    }
  }
  const { image } = thumbnail({ vertices }, { faces }, new Map());
  return { contents: { kind: "markdown", value: text + "\n\n" + imageMarkdown("Collider shape", image) } };
}

module.exports = { colliderSection, primitiveHover };
