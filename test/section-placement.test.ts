import test from "node:test";
import assert from "node:assert/strict";
import { TextDocument } from "vscode-languageserver-textdocument";
import { Catalog } from "../src/catalog";
import { diagnostics } from "../src/features";
import { parse } from "../src/ini";
import { moveMisplacedKey, placementCode } from "../src/section-placement";

const uri = "file:///mod/vessels/radar.ini";
const registry = "[Submodels]\nSensors_1=RadarDish";
const model = "[RadarDish] # visible antenna\nMesh=antenna";
const sensor = "[SensorSystem14]\nMount=RadarDish";
const material = "  Material = custom_mat.ini  // paint";

function check(text: string) {
  const document = TextDocument.create(uri, "seapower-ini", 7, text);
  const doc = parse(text);
  const issues = diagnostics(doc, new Catalog(), uri).filter(d => d.code === placementCode);
  const fix = issues.length && moveMisplacedKey(document, doc, issues[0], true);
  return { document, issues, fix };
}

test("move a sensor material to its declared mount, preserving the line and file ending", () => {
  for (const eol of ["\n", "\r\n"]) for (const sensorFirst of [true, false]) for (const ending of ["", eol]) {
    const blocks = (sensorText: string, modelText: string) =>
      [registry, ...(sensorFirst ? [sensorText, modelText] : [modelText, sensorText])].join("\n").replaceAll("\n", eol) + ending;
    const { document, issues, fix } = check(blocks(sensor + "\n" + material, model));
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, 2);
    assert.equal(document.getText(issues[0].range), "Material");
    assert.equal(fix.title, "Move Material to [RadarDish]");
    const [change] = fix.edit.documentChanges;
    assert.ok("textDocument" in change);
    assert.deepEqual(change.textDocument, { uri, version: 7 });
    const result = TextDocument.applyEdits(document, change.edits);
    assert.equal(result, blocks(sensor, model.replace("\n", "\n" + material + "\n")));
    assert.equal(check(result).issues.length, 0);
  }
});

test("recognize legacy model lists, material texture overrides and inline suppression", () => {
  const text = ["[Models]", "SubModel1=RadarDish", model, sensor, "MaterialTextureNormal=normal",
    "ResourcesMaterialFolder=ships/ ; sp-ini-ignore ignored-section-key", "CustomModSetting=paint"].join("\n");
  const { issues, fix } = check(text);
  assert.equal(issues.length, 1);
  assert.equal(fix.title, "Move MaterialTextureNormal to [RadarDish]");
  assert.equal(check(text + "\n[Submodels]\nPart=SensorSystem14").issues.length, 0);
});

test("ambiguous, inherited, dummy and already configured mounts keep the warning without an edit", () => {
  const text = [registry, model, sensor, material].join("\n");
  for (const variant of [
    text.replace("Mount=RadarDish", "Mount=Dummy"),
    text.replace("Mount=RadarDish", "Mount=Missing"),
    text.replace("Mount=RadarDish", "# no mount"),
    text.replace("Mount=RadarDish", "Mount=RadarDish\nMount=Other"),
    text.replace(model, "#!extend vessels/base.ini"),
    text.replace(registry, "[Submodels]\nPart=Other"),
    text + "\n[RadarDish]",
    text + "\n[SensorSystem14]\nMount=Other",
    text.replace(model, model + "\nmAtErIaL=existing"),
    text.replace(model, "#!repeat 2\n" + model + "\n#!end"),
  ]) {
    const { issues, fix } = check(variant);
    assert.equal(issues.length, 1);
    assert.equal(fix, undefined);
  }
});

test("check declared key roles across sections and move only to an unambiguous destination", () => {
  const misplaced = check([registry, model, "[SensorSystem2_USA]", "FiringArcs=60,-60", "[WeaponSystem3_Default]",
    "Mount=RadarDish", "Material=paint", "[SensorSystems]", "NumberOfWeaponSystems=2", "[WeaponSystems]"].join("\n"));
  assert.deepEqual(misplaced.issues.map(d=>misplaced.document.getText(d.range)),["FiringArcs","Material","NumberOfWeaponSystems"]);
  const actions=misplaced.issues.map(d=>moveMisplacedKey(misplaced.document,parse(misplaced.document.getText()),d,true)?.title);
  assert.deepEqual(actions,[undefined,"Move Material to [RadarDish]","Move NumberOfWeaponSystems to [WeaponSystems]"]);
  const valid=check([registry,model,"[SensorSystem2_USA]","Mount=RadarDish","RestAngles=180","ModSetting=1","[WeaponSystem3_Default]",
    "FiringArcs=60,-60","[SensorSystems]","NumberOfSensorSystems=1","[Unknown]","Material=wildcard.ini"].join("\n"));
  assert.equal(valid.issues.length,0);
});
