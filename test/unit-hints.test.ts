import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "../src/ini";
import { unitHints } from "../src/unit-hints";

const all = { start: { line: 0, character: 0 }, end: { line: 100, character: 0 } };
test("Spruance cavitation and flow noise show their distinct units", async () => {
  const doc = parse("[SensorData]\nCavitationNoise=5\nFlowNoise=1");
  const hints = await unitHints(doc, "vessels/usn_dd_spruance_vls.ini", all);
  assert.deepEqual(hints.map(h => [h.position.line, h.position.character, h.label]), [[1, 17, "dB"], [2, 11, "dB/kt"]]);
});
test("hints follow vanilla field context and end at the numeric value", async () => {
  const doc = parse("[Performance]\n EmptyMass = 51710  // in kg\nMaxFuel=5e4\nPerEngineMaxThrust=91600\nBypassRatio=0.3\nAltitudes=100, 200\nMaxFuel=unknown\n[Other]\nEmptyMass=51710");
  const hints = await unitHints(doc, "aircraft/mod.ini", all);
  assert.deepEqual(hints.map(h => [h.position.line, h.position.character, h.label]), [
    [1, 18, "kg"], [2, 11, "kg"], [3, 24, "N"], [5, 18, "ft"]
  ]);
  assert.deepEqual(await unitHints(doc, "vessels/mod.ini", all), []);
  assert.deepEqual(await unitHints(doc, "aircraft/mod.ini", {start:{line:1,character:19},end:{line:2,character:10}}), []);
});
test("the same sensor key can use different units and conflicting vanilla annotations stay hidden", async () => {
  const sensors = parse("[CustomA]\nKind=Radar\nMaxRange=20\n[CustomB]\nKind=LaserDesignator\nMaxRange=20");
  assert.deepEqual((await unitHints(sensors, "systems/sensors.ini", all)).map(h => h.label), ["km", "nmi"]);
  assert.deepEqual(await unitHints(parse("[Guidance]\nSeekerFOV=60"), "ammunition/custom.ini", all), []);
});
test("cruise speed and range have separate hints and respect inherited units", async () => {
  const text = "[Performance]\nSpeedAndRange_Cruise= 10 , 3910";
  const hints = (source: string, inherited?: () => Promise<string>) => unitHints(parse(source), "aircraft/mod.ini", all, inherited);
  assert.deepEqual((await hints(text)).map(h => [h.position.character, h.label]), [[24, "Mach"], [31, "nmi"]]);
  assert.deepEqual((await hints(text.replace("10 ,", "11 ,") + "\nRangeUnits=kM")).map(h => h.label), ["kt", "km"]);
  const copy = "#!copy aircraft/base.ini\n" + text;
  assert.deepEqual((await hints(copy, async () => "Km")).map(h => h.label), ["Mach", "km"]);
  assert.deepEqual((await hints(copy)).map(h => h.label), ["Mach"]);
  assert.deepEqual((await hints(copy.replace("aircraft/base.ini", "base.ini"), async () => "Km")).map(h => h.label), ["Mach", "km"]);
});
