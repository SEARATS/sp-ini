import assert from "node:assert/strict";
import test from "node:test";
import manifest from "../package.json";
import { meshFlagMatcher, meshFlagSetting } from "../src/mesh-flags";

test("stock flag rules recognize compound variants across object and mesh names", () => {
  const match = meshFlagMatcher(manifest.contributes.configuration.properties[meshFlagSetting].default);
  const labels = (...names: string[]) => match(...names).map(flag => flag.label);
  assert.deepEqual(labels("Deck", "usn_dd_spruance_vls_deck_d_lod1"), ["Damaged", "LOD"]);
  assert.deepEqual(labels("ara_fs_drummond_lod1_d"), ["Damaged", "LOD"]);
  assert.deepEqual(labels("arg_e111_glass_d1", "ARG_E111_GLASS_D1"), ["Damaged", "Glass"]);
  assert.deepEqual(labels("airbase_1_trans", "administration_lod_1"), ["LOD", "Transparent"]);
  assert.deepEqual(labels("Hull_Col", "meshcoll"), ["Collider"]);
  assert.deepEqual(labels("colombia", "old_colonial"), []);
});

test("custom flags respect order, literal substrings, enablement and empty settings", () => {
  const match = meshFlagMatcher([
    {label:"Dot", substrings:["."]}, {label:"Deck", patterns:["[", "^deck$"]},
    {label:"Off", enabled:false, substrings:["deck"]}, {label:"Empty", patterns:[""]}, null
  ]);
  assert.deepEqual(match("DECK", "a.b"), [{label:"Dot", icon:"tag"}, {label:"Deck", icon:"tag"}]);
  assert.deepEqual(match("foredeck"), []);
  assert.deepEqual(meshFlagMatcher([])("Hull_Col"), []);
});
