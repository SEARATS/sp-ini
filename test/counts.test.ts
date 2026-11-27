import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../src/ini";
import { diagnostics } from "../src/features";

const check = (text: string, family = "vessels") => diagnostics(parse(text), undefined, "file:///example/" + family + "/sample.ini");
const codes = (text: string, family?: string) => check(text, family).map(d => d.code);

test("counts distinguish invalid numbers, negative integers, overflow and missing collider slots", () => {
  for (const [value, code] of [["-1","negative-count"], ["1.5","invalid-value"], ["big","invalid-value"], ["2147483648","count-overflow"]]) {
    const [issue] = check("[Colliders]\nNumberOfColliders=" + value);
    assert.deepEqual([issue.code,issue.severity], [code,1]);
  }
  const colliders = "[Colliders]\nNumberOfColliders=2\nCollider1=Hull\nCollider3=Deck\nNumberOfMeshColliders=1\nMeshCollider1=Mesh";
  const issues = check(colliders);
  assert.deepEqual(issues.map(d => [d.code,d.severity]), [["count-too-small",2],["count-too-large",2]]);
  assert.match(issues[0].message,/Collider3/);
  assert.match(issues[1].message,/Collider2/);
  assert.deepEqual(codes(colliders.replace("Collider3","Collider2")), []);
  assert.deepEqual(codes("[Colliders]\nNumberOfColliders=2147483647"), ["count-too-large"]);
  assert.deepEqual(codes("[Colliders]\nNumberOfColliders=0\n;Collider1=Hull"), []);
  assert.deepEqual(codes("[Colliders]\nMeshCollider1=Mesh"), ["count-too-small"]);
  assert.deepEqual(codes("[Colliders]\nNumberOfColliders=1 ; sp-ini-ignore count-too-large"), []);
  assert.deepEqual(codes("[SensorData]\nBladesCount=-1\n[Cargo]\nNumberOfCargoSlots=-4"), ["negative-count","negative-count"]);
  assert.deepEqual(codes("[General]\nNumberOfDCTeams=-1\n[Custom]\nOffsetCount=-1"), []);
});

test("submodel lists honor the separate registry and count checks account for partial files", () => {
  const models = "[Models]\nNumberOfSubModels=1\nSubModel1=Hull\nSubModel2=Deck";
  assert.deepEqual(codes(models), ["count-too-small"]);
  assert.deepEqual(codes(models + "\n[Submodels]\nUpper=Deck"), []);
  assert.deepEqual(codes("[Submodels]\nHull=Hull\nDeck=Deck"), []);
  assert.deepEqual(codes("#!extend vessels/base.ini\n[Colliders]\nNumberOfColliders=20"), []);
  assert.deepEqual(codes("#!extend vessels/base.ini\n[Colliders]\nNumberOfColliders=-2"), ["negative-count"]);
  assert.deepEqual(codes("[Colliders]\nNumberOfColliders=2\n#!repeat i=1-2\nCollider{i}=Deck{i}\n#!end"), []);
});

test("animations accept compact and expanded steps, implicit defaults, and signed transforms", () => {
  const header = "[Animations]\nAnimation1=Move\n[Move]\nSequence1=Travel\nSequence1_Model=Hull\n[Travel]\n";
  const steps = "Step1=0|x,0,z|None|EaseInOut\nTime2=1\nRotationX2=-90\nPosition2=0,-3,2";
  assert.deepEqual(codes(header + "NumberOfSteps=2\n" + steps, "animations"), []);
  assert.deepEqual(codes(header + steps, "animations"), ["count-too-small"]);
  assert.deepEqual(codes(header + "NumberOfSteps=3\n" + steps, "animations"), ["count-too-large"]);
  assert.deepEqual(codes(header + "NumberOfSteps=-2", "animations"), ["negative-count"]);
  assert.deepEqual(codes(header + "Step1=oops|none|none|Linear", "animations"), ["invalid-value"]);
  assert.deepEqual(codes(header + "Step1=0|none|none", "animations"), ["invalid-value"]);
  const typo = "Step1=0|x, typo,z|0,0,0,45|Linear";
  const ignored = check(header + typo, "animations");
  assert.deepEqual(ignored.map(d => [d.code, typo.slice(d.range.start.character,d.range.end.character)]),
    [["ignored-step-component","typo"],["ignored-step-component","45"]]);
  assert.deepEqual(codes(header + "Rotation1=1,2\nTime1=nope", "animations"), ["invalid-value","invalid-value"]);
  assert.deepEqual(codes("[Sequence]\nStep1=arbitrary", "vessels"), []);
});
