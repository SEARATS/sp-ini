import fields from "./unit-fields.json";
import { sectionGroup } from "./ini";

const unitFamilies = new Set(["vessels", "aircraft", "land_units", "biologic"]);
const rules = new Map();
function register(family, section, type, keys) {
  keys.forEach(key => rules.set([family, sectionGroup(section), key.toLowerCase()].join("/"), type));
}
for (const [family, sections] of Object.entries(fields))
  for (const [section, types] of Object.entries(sections))
    for (const [type, keys] of Object.entries(types)) register(family, section, type, keys);

register("shared", "General", "number", ["Length", "Beam", "CompartmentsHeight", "FrontalArea", "SideArea", "BottomArea", "Volume"]);
register("shared", "SensorData", "count", ["BladesCount"]);
register("shared", "FlightDeck", "count", ["NumberOfDeckZones", "NumberOfElevators", "NumberOfLaunchPoints", "NumberOfRecoveryPoints", "NumberOfTaxiPaths", "NumberOfTaxiPoints"]);
register("shared", "DeckZone1", "count", ["NumberOfPoints"]);
register("shared", "PropulsionSystems", "count", ["NumberOfPropulsionSystems"]);
register("shared", "RudderSystems", "count", ["NumberOfRudderSystems"]);
register("shared", "DepthRudderSystems", "count", ["NumberOfDepthRudderSystems"]);
register("shared", "WeaponSystem1", "count", ["NumberOfGuns", "NumberOfContainers", "NumberOfHatchesPerContainer", "NumberOfAssociatedSensors"]);
register("aircraft", "FlightControls", "count", ["NumberOfAilerons", "NumberOfElevators", "NumberOfElevons", "NumberOfRotors", "NumberOfRudders", "NumberOfSpeedbrakes", "NumberOfSpoilerons"]);
register("aircraft", "WingSweep", "count", ["NumberOfAngles"]);
register("mission", "Environment", "latitude", ["MapCenterLatitude"]);
register("mission", "Environment", "longitude", ["MapCenterLongitude"]);

const armor = ["None", "Minor", "Moderate", "Heavy"];
const boolean = ["True", "False"];
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const isNumber = text => decimal.test(text.trim()) && Number.isFinite(Number(text));
const choices = type => type === "armor" ? armor : type === "boolean" ? boolean : [];
const descriptions = { armor: armor.join(", "), boolean: "True or False", integer: "an integer", number: "a number",
  count: "a whole-number count", step: "time|position|rotation|smoothness with a numeric time",
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
  if (group === "animations") {
    if (/^numberof(steps|sequencestoplay)$/.test(name) || (id === "animations/numberofanimations")) return { type: "count" };
    if (/^(?:time|(?:position|rotation)[xyz])\d+$/.test(name)) return { type: "number" };
    if (/^(?:position|rotation)\d+$/.test(name)) return { type: "vector3" };
    if (/^step\d+$/.test(name)) return { type: "step" };
  }
  if (id === "models/numberofsubmodels" || /^colliders\/numberof(?:mesh)?colliders$/.test(id)) return { type: "count" };
  if (type === "integer" && name.startsWith("numberof")) return { type: "count" };
  if (type) return { type };
  const sample = catalog?.sections.get(sectionGroup(section))?.get(group)?.keys.get(name)?.stock;
  if (sample?.multiple && sample.type !== "text") return { type: sample.type, inferred: true };
}

// Compact steps leave nonnumeric axes unchanged. Stock files use x/y/z, empty fields or None.
function* ignoredStepComponents(value: string) {
  const fields = value.split("|");
  let start = fields[0].length + 1;
  for (const [column, field] of fields.slice(1, 3).entries()) {
    if (!/^(?:none)?$/i.test(field.trim())) {
      let offset = start;
      for (const [axis, component] of field.split(",").entries()) {
        const raw = component.trim();
        if (raw && (axis >= 3 || (!isNumber(raw) && !/^[xyz]$/i.test(raw)))) {
          const at = offset + component.indexOf(raw);
          const name = column === 0 ? "position" : "rotation";
          yield {start: at, end: at + raw.length, message: axis >= 3
            ? "Sea Power ignores " + name + " components after Z."
            : "Sea Power leaves the " + name + " " + "XYZ"[axis] + " axis unchanged for '" + raw + "'."};
        }
        offset += component.length + 1;
      }
    }
    start += field.length + 1;
  }
}

function validValue(type, value) {
  const options = choices(type);
  if (options.length) return options.some(option => option.toLowerCase() === value.toLowerCase());
  if (type.startsWith("vector")) return scalarType(value) === type;
  if (type === "step") {
    const fields = value.split("|");
    return fields.length === 4 && isNumber(fields[0]);
  }
  if (!isNumber(value)) return false;
  const number = Number(value);
  if (type === "integer" || type === "count") return Number.isInteger(number);
  if (type === "latitude") return Math.abs(number) <= 90;
  if (type === "longitude") return Math.abs(number) <= 180;
  return true;
}

const expected = type => descriptions[type] || type.slice(-1) + " comma-separated numbers";
export { ignoredStepComponents, scalarType, valueRule, validValue, choices, expected };
