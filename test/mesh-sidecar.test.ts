import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { meshSidecar, moveMesh, readMeshOverrides, readMeshTags, writeMeshTags } from "../src/mesh-sidecar";
import { colliderType } from "../src/mesh-names";
import { meshFlagMatcher } from "../src/mesh-flags";

test("all model formats share exact-name tag edits while other models keep their defaults", t => {
  const dir = mkdtempSync(join(tmpdir(), "sp-ini-tags-"));
  t.after(() => rmSync(dir, {recursive:true, force:true}));
  const files = ["fbx","OBJ","blend"].map(ext => join(dir, "ship.v2." + ext));
  const sidecar = meshSidecar(files[0]);
  assert.equal(sidecar, join(dir, "ship.v2.meshes.yaml"));
  assert.equal(readMeshTags(files[1]).size, 0);
  writeMeshTags(files[0], "Hull_col", new Map([["Collider", false], ["Painted", true]]));
  for (const file of files) {
    const tags = readMeshTags(file);
    assert.equal(colliderType(tags, "Hull_col"), false);
    assert.equal(colliderType(tags, "Other_col"), true);
    assert.deepEqual(meshFlagMatcher([], tags)("Hull_col").map(f => f.label), ["Painted"]);
  }
  writeFileSync(sidecar, "# author note\n" + readFileSync(sidecar, "utf8"));
  writeMeshTags(files[2], "Keel", new Map([["Collider", true]]));
  writeMeshTags(files[1], "Hull_col", new Map([["Painted", false], ["Damaged", false]]));
  const tags = readMeshTags(files[0]);
  assert.equal(colliderType(tags, "Keel"), true);
  assert.equal(colliderType(tags, "Hull_col", "Keel"), false);
  assert.deepEqual(meshFlagMatcher([{label:"Damaged", substrings:["Hull"]}], tags)("Hull_col"), []);
  assert.match(readFileSync(sidecar, "utf8"), /# author note/);
  moveMesh(files[0],["A","B","C"],"C",-1);
  moveMesh(files[2],["C","A","B"],"C",-1);
  assert.deepEqual(readMeshOverrides(files[1]).order,["C","A","B"]);
  assert.equal(readMeshTags(files[2]).get("Keel").get("Collider"),true);
  assert.equal(readMeshTags(join(dir, "different.obj")).size, 0);
  const bad = "meshes:\n  Keel:\n    add: Wrong\n";
  writeFileSync(sidecar, bad);
  assert.throws(() => writeMeshTags(files[2], "Keel", new Map([["Glass", true]])), /Keel.add/);
  assert.equal(readFileSync(sidecar, "utf8"), bad);
});
