const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Catalog } = require("../src/catalog");
const { parse } = require("../src/ini");
const { diagnostics, documentLinks } = require("../src/features");
const { sectionEdit, suppression } = require("../src/ini-edits");
const { MeshFiles } = require("../src/meshes");
const { meshHover, thumbnail } = require("../src/mesh-hover");

test("mesh definitions and wireframes use the referenced OBJ and global vertex indices", async () => {
  const uri = "file:///mod/vessels/sample.ini";
  const catalog = new Catalog();
  const obj = "file:///mod/ships/test.obj";
  catalog.assets.set("ships/test.obj", [{ file: { uri: obj } }]);
  const text = "v 0 0 0\nv 1 0 0\nv 0 1 0\n  o Part\nf -3/1 -2/2 -1/3\no Other\nv 1 1 1";
  const mesh = new MeshFiles(id => id === obj && { version: 1, getText: () => text });
  const doc = parse("[Models]\nResourcesFolder=ships\nResourcesRoot=test.obj\n[Part]\nMesh=Part\n[Missing]\nMesh=Missing");
  const [ref] = await mesh.resolve(doc, uri, doc.entries[2], catalog);
  assert.deepEqual([ref.file.uri, ref.line, ref.start], [obj, 3, 4]);
  assert.match(meshHover(ref.model, ref.object).contents.value, /1 face/);
  assert.match(meshHover(ref.model, ref.object).contents.value, /data:image\/png;base64,iVBOR/);
  assert.deepEqual(await mesh.resolve(doc, uri, doc.entries[3], catalog), []);
  assert.ok(!documentLinks(doc, uri, catalog).some(l => [4, 6].includes(l.range.start.line)));
  const colliders = parse("[Models]\nResourcesFolder=ships\nResourcesRoot=test.obj\n[Colliders]\nMeshCollider1=Hitbox\n[Hitbox]\nCollider=Part\n[Part]\n[ControlSystem]\nCollider=Hitbox");
  const targets = await mesh.resolve(colliders, uri, colliders.entries.find(e => e.value === "Part"), catalog);
  assert.deepEqual(targets.map(ref => [ref.file.uri, ref.line]), [[obj, 3]]);
  const links = documentLinks(colliders, uri, catalog);
  assert.ok(!links.some(l => l.range.start.line === 6));
  assert.ok(links.some(l => l.range.start.line === 9 && l.target === uri + "#L6"));
});

test("suppressing one diagnostic preserves other rules and the same rule on other lines", () => {
  const doc = parse("[General]\nArmorType=None\nArmorType=typo ; keep comment ; sp-ini-ignore invalid-value\nArmorType=typo");
  const issues = diagnostics(doc, new Catalog(), "file:///mod/vessels/demo.ini");
  assert.deepEqual(issues.map(d => [d.range.start.line, d.code]), [[2, "conflicting-duplicate-key"], [3, "conflicting-duplicate-key"], [3, "invalid-value"]]);
  assert.deepEqual(suppression(doc.lines[2], 2, "conflicting-duplicate-key"), { line: 2, start: doc.lines[2].length, text: ",conflicting-duplicate-key" });
  assert.equal(parse("#!extend file.ini ; sp-ini-ignore missing-target").modifiers[0].args, "file.ini");
});

test("commenting a section and restoring it preserves directives, comments, indentation and adjacent sections", () => {
  const lines = ["[First]", "  A=1", "; existing comment", "#!alias a.ini", "", "[Other]", "B=2"];
  const apply = (input, index) => {
    const copy = [...input];
    for (const e of sectionEdit(copy, index).edits) copy[e.line] = e.text + copy[e.line].slice(e.length);
    return copy;
  };
  const commented = apply(lines, 1);
  assert.deepEqual(parse(commented.join("\n")).sections.map(s => s.name), ["Other"]);
  assert.deepEqual(parse(commented.join("\n")).modifiers, []);
  assert.deepEqual(apply(commented, 2), lines);
});

test("textured OBJ faces use counterclockwise winding while wireframes show both sides", () => {
  const model = { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], uvs: [[0, 0]] };
  const texture = { width: 1, height: 1, data: Buffer.from([255, 0, 0, 255]) };
  function sample(indices) {
    const face = { indices, texcoords: [0, 0, 0] };
    return thumbnail(model, { faces: [face] }, new Map([["", texture]]));
  }
  const front = sample([0, 1, 2]), back = sample([2, 1, 0]);
  const red = preview => preview.textured.data.some((c, i) => i % 4 === 0 && c === 255);
  assert.ok(red(front));
  assert.equal(red(back), false);
  assert.deepEqual(front.image.data, back.image.data);
});

test("the lit material plane includes all four corners and keeps the texture aspect ratio", () => {
  const { materialSwatch } = require("../src/material-swatch");
  const map = { width: 4, height: 2, data: Buffer.from([
    255,0,0,255, 0,0,0,255, 0,0,0,255, 0,255,0,255,
    0,0,255,255, 0,0,0,255, 0,0,0,255, 255,255,255,255
  ]) };
  const image = materialSwatch(new Map([["_maintex", map]]));
  assert.equal(image.width, image.height * 2);
  const color = (x, y) => [...image.data.subarray(4 * (y * image.width + x), 4 * (y * image.width + x) + 3)].map(v => v > 128);
  assert.deepEqual([color(0, 0), color(image.width - 1, 0), color(0, image.height - 1), color(image.width - 1, image.height - 1)],
    [[true,false,false], [false,true,false], [false,false,true], [true,true,true]]);
});

test("an explicit FBX mesh path links to the indexed model", () => {
  const catalog = new Catalog(), uri = "file:///mod/vessels/sample.ini";
  const target = "file:///mod/ships/destroyer.fbx";
  catalog.assets.set("ships/destroyer.fbx", [{ file: { uri: target }, name: "destroyer.fbx", start: 0, line: 0 }]);
  const doc = parse("[Models]\nResourcesFolder=ships\nResourcesRoot=destroyer.fbx\n[Hull]\nMesh=destroyer.fbx");
  assert.deepEqual(documentLinks(doc, uri, catalog).map(link => link.target), [target, target]);
});
