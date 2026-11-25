const test = require("node:test");
const assert = require("node:assert/strict");
const { Catalog } = require("../src/catalog");
const { parse } = require("../src/ini");
const { diagnostics, inspect, exact, documentLinks, completions } = require("../src/features");
const uri = "file:///mod/vessels/test.ini";

test("mount part links use declared submodels and preserve ContainerBase sentinels", () => {
  const c = new Catalog();
  const body = "[Submodels]\nSubModel1=MountBase\nSubModel2=MovingPart\n[MountBase]\n[MovingPart]\n[WeaponSystem1]\nContainerBase=MountBase\nGun1=MovingPart\nGun2=Unrelated\n[Unrelated]\n[WeaponSystem2]\nContainerBase=Dummy";
  const doc = parse(body);
  const links = documentLinks(doc, uri, c);
  assert.equal(links.find(l => l.range.start.line === 6).target, uri + "#L4");
  assert.equal(links.find(l => l.range.start.line === 7).target, uri + "#L5");
  assert.deepEqual(diagnostics(doc, c, uri).map(d => d.range.start.line), [8]);
  c.add({ rel: "vessels/base.ini", uri: "file:///base.ini", source: "Vanilla" }, doc);
  const patch = parse("#!extend vessels/base.ini\n[WeaponSystem1]\nGun1=MovingPart");
  assert.equal(documentLinks(patch, uri, c).find(l => l.range.start.line === 2).target, "file:///base.ini#L5");
});

test("identical repeats warn, conflicting assignments point to the earlier different value", () => {
  const doc = parse("[Paint]\nShade=Grey\nshade = Grey ; same\nShade=Blue\nShade=Grey\n[Next]\nShade=Blue");
  const issues = diagnostics(doc, new Catalog(), uri);
  assert.deepEqual(issues.map(d => [d.code, d.severity]), [
    ["duplicate-key", 2], ["conflicting-duplicate-key", 1], ["conflicting-duplicate-key", 1]
  ]);
  assert.deepEqual(issues.slice(1).map(d => d.relatedInformation[0].location.range.start.line), [1, 3]);
});

test("checks unsaved armor edits before indexing and preserves the comment", () => {
  const catalog = new Catalog();
  const input = "[General]\r\n ArmorType = Heavyd   // test";
  const [issue] = diagnostics(parse(input), catalog, uri);
  assert.equal(issue.severity, 1);
  assert.deepEqual(issue.range, { start: { line: 1, character: 13 }, end: { line: 1, character: 19 } });
  assert.match(issue.message, /Heavy/);
  for (const value of ["Heavy", "mOderate", "Minor", "None"]) {
    assert.deepEqual(diagnostics(parse(input.replace("Heavyd", value)), catalog, uri), []);
  }
  const doc = parse("[General]\nArmorType=He");
  const pos = { line: 1, character: 12 };
  assert.equal(completions(inspect(doc, uri, pos, catalog), pos)[0].label, "Heavy");
  assert.deepEqual(diagnostics(parse(input), catalog, "file:///mod/custom.ini"), []);
});

test("infers formats from separate vanilla files, independent of local examples", () => {
  const c = new Catalog();
  for (const [source, file, value] of [["Workspace", "test", "oops"], ["Vanilla", "a", "1,2,3"], ["Vanilla", "b", "2,3,4"]]) {
    c.add({ source, rel: "vessels/" + file + ".ini", uri: "file:///vessels/" + file + ".ini" }, parse("[Physics]\nCustomVector=" + value));
  }
  const doc = parse("[Physics]\nCustomVector=oops\n[General]\nDefaultCameraDistance=near");
  assert.deepEqual(diagnostics(doc, c, uri).map(d => d.severity), [2, 1]);
});

test("resolves a list item, a material path and all matching catalog sections", () => {
  const c = new Catalog();
  const add = (source, rel, body) => c.add({ source, rel, uri: "file:///" + source + "/" + rel }, parse(body));
  add("Local", "ships/test/red.ini", "[Shader]");
  for (const source of ["Workshop", "Vanilla"]) add(source, "systems/sensors.ini", "; comment\n[Example]");
  const doc = parse("[Models]\nResourcesFolder=ships/test/\nResourcesMaterial=red.ini\n[SensorSystem1]\nSystemName=Example\n[SensorSystem2]\n[WeaponSystem1]\nAssociatedSensors=SensorSystem1, SensorSystem2");
  const lookup = (line, character) => exact(inspect(doc, uri, { line, character }, c));
  assert.equal(lookup(2, 20)[0].file.rel, "ships/test/red.ini");
  assert.equal(lookup(7, 35)[0].line, 5);
  assert.deepEqual(lookup(4, 15).map(r => r.file.source), ["Workshop", "Vanilla"]);
  assert.equal(documentLinks(doc, uri, c).filter(l => l.range.start.line === 7).length, 2);
  const missing = diagnostics(parse("[SensorSystem1]\nSystemName=Unknown"), c, uri);
  assert.match(missing[0].message, /No indexed sensors/);
});
