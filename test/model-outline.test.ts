import { test } from "node:test";
import assert from "node:assert/strict";
import { objOutline, fbxOutline } from "../src/model-outline";
import { type ModelNode, colliderSnippet } from "../src/hierarchy";

test("OBJ objects are peers and shared groups can belong to multiple objects", () => {
  const nodes = objOutline("o First\ng A B\nf 1 2 3\no Second\nf 2 3 4\ng A\ng\no Empty\n");
  assert.deepEqual(nodes.map(n => [n.name,n.children.map(c => c.name)]), [
    ["First",["A","B"]], ["Second",["A","B"]], ["Empty",[]]
  ]);
  assert.equal(objOutline("g Group\nf 1 2 3")[0].name, "(unnamed object)");
});

test("FBX outline preserves separate model IDs and collider export uses its immediate parent's space", () => {
  const node = (id: string, name: string, children: ModelNode[] = []): ModelNode => ({
    id, name, mesh: name, path: id, position: [1,2,3], children
  });
  const roots = [node("1","Scene",[node("2","Hub",[node("3","Blade")]),node("4","Spare",[node("5","Blade")])])];
  const outline = fbxOutline(roots);
  assert.deepEqual(outline[0].children.map(child => [child.name,child.children[0].modelId]),[["Hub","3"],["Spare","5"]]);
  const result = colliderSnippet("ship.fbx",roots,new Set(["3"]));
  assert.match(result,/Collider=Blade\nParent=Hub\nPosition=1,2,3/);
  assert.doesNotMatch(result,/SubModel|Spare/i);
});
