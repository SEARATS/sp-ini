const fields = require("./unit-fields.json");
const { sectionGroup } = require("./ini");

const unitFamilies = new Set(["vessels", "aircraft", "land_units", "biologic"]);
const rules = new Map();
function register(family, section, type, keys) {
  keys.forEach(key => rules.set([family, sectionGroup(section), key.toLowerCase()].join("/"), type));
}
for (const [family, sections] of Object.entries(fields))
  for (const [section, types] of Object.entries(sections))
    for (const [type, keys] of Object.entries(types)) register(family, section, type, keys);

register("shared", "General", "number", ["Length", "Beam", "CompartmentsHeight", "FrontalArea", "SideArea", "BottomArea", "Volume"]);
register("mission", "Environment", "latitude", ["MapCenterLatitude"]);
register("mission", "Environment", "longitude", ["MapCenterLongitude"]);

const armor = ["None", "Minor", "Moderate", "Heavy"];
const boolean = ["True", "False"];
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const isNumber = text => decimal.test(text.trim()) && Number.isFinite(Number(text));
const choices = type => type === "armor" ? armor : type === "boolean" ? boolean : [];
const descriptions = { armor: armor.join(", "), boolean: "True or False", integer: "an integer", number: "a number",
  latitude: "a latitude from -90 to 90", longitude: "a longitude from -180 to 180" };

function scalarType(value) {
  if (boolean.some(v => v.toLowerCase() === value.toLowerCase())) return "boolean";
  if (isNumber(value)) return "number";
  const tuple = value.split(",");
  if (tuple.length >= 2 && tuple.length <= 4 && tuple.every(isNumber)) return "vector" + tuple.length;
  return "text";
}

function valueRule(group, section, key, catalog) {
  if (!section) return;
  const name = key.toLowerCase(), id = sectionGroup(section) + "/" + name;
  const unit = unitFamilies.has(group);
  if (unit && name === "armortype" && /^(general|controlsystem|mainpowersystem|.*system\d+|.*magazine.*)$/i.test(section))
    return { type: "armor" };
  const type = rules.get(group + "/" + id) || (unit && rules.get("shared/" + id));
  if (type) return { type };
  const sample = catalog?.sections.get(sectionGroup(section))?.get(group)?.keys.get(name)?.stock;
  if (sample?.multiple && sample.type !== "text") return { type: sample.type, inferred: true };
}

function validValue(type, value) {
  const options = choices(type);
  if (options.length) return options.some(option => option.toLowerCase() === value.toLowerCase());
  if (type.startsWith("vector")) return scalarType(value) === type;
  if (!isNumber(value)) return false;
  const number = Number(value);
  if (type === "integer") return Number.isInteger(number);
  if (type === "latitude") return Math.abs(number) <= 90;
  if (type === "longitude") return Math.abs(number) <= 180;
  return true;
}

const expected = type => descriptions[type] || type.slice(-1) + " comma-separated numbers";
module.exports = { scalarType, valueRule, validValue, choices, expected };
