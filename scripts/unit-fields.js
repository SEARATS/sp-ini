// Run with the path to the Seapower namespace of a locally exported game assembly.
const fs = require("node:fs");
const path = require("node:path");
const loaders = {
  shared: ["ObjectBaseLoader"], vessels: ["VesselLoader", "SubmarineLoader"],
  aircraft: ["AircraftLoader", "HelicopterLoader"], land_units: ["LandUnitLoader"], biologic: ["BiologicLoader"]
};
const schema = {};
for (const [family, names] of Object.entries(loaders)) {
  const fields = new Map();
  for (const name of names) {
    const code = fs.readFileSync(path.join(process.argv[2], name + ".cs"), "utf8");
    for (const [, section, key, initial] of code.matchAll(/\bini\.readValue\("(\w+)", "(\w+)", ([^,)\n]+)/g)) {
      const type = /^(true|false)$/.test(initial) ? "boolean"
        : /^-?\d+$/.test(initial) ? "integer"
        : /^-?\d+(\.\d+)?[fd]$/i.test(initial) ? "number" : undefined;
      const id = section + "." + key;
      if (!fields.has(id)) fields.set(id, new Set());
      fields.get(id).add(type);
    }
  }
  schema[family] = {};
  for (const [id, types] of [...fields].sort()) {
    if (types.size !== 1 || types.has(undefined)) continue;
    const [section, key] = id.split(".");
    const group = schema[family][section] ||= {};
    (group[[...types][0]] ||= []).push(key);
  }
}
fs.writeFileSync(path.join(__dirname, "../src/unit-fields.json"), JSON.stringify(schema, null, 2) + "\n");
