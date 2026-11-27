import assert from "node:assert/strict";
import test from "node:test";
import { exportCategories, exportRows, objExportHierarchy, planExport } from "../src/export-plan";
import { assignPaths, type ModelNode } from "../src/hierarchy";

const all = new Set(exportCategories);
const node = (name: string, mesh: string, x: number, children: ModelNode[] = []): ModelNode =>
  ({id:name, name, mesh, path:"", position:[x,0,0], children});

test("the plan includes all roots and reclassification happens before category filtering", () => {
  const roots = assignPaths([node("Frame","",1,[node("Hull","hull_mesh",2), node("Keel_col","keel",3)]), node("Deck","deck",4)]);
  assert.deepEqual(exportRows(roots).map(r => r.category), ["Helper","Mesh","Collider","Mesh"]);
  const preview = planExport("ship.fbx", roots, all, new Map());
  assert.equal(preview.count, 4);
  assert.match(preview.text, /\[Frame\]\nMesh=Dummy/);
  const roles = new Map([["/Frame/Hull","Collider" as const]]);
  const selected = planExport("ship.fbx",roots,new Set(["Collider"]),roles);
  assert.equal(selected.count, 2);
  assert.match(selected.text, /\[Hull\]\nCollider=hull_mesh\nParent=VisibleParent\nPosition=3,0,0/);
  assert.doesNotMatch(selected.text, /\[Submodels\]|\[Frame\]/);
  assert.equal(planExport("ship.fbx", roots, new Set(),roles).text, "");
  const existing = "[Submodels]\nNumberOfSubmodels=0\nSubModel1=Reserve\n";
  assert.ok(planExport("ship.fbx",roots,new Set(["Collider"]),roles,existing).after.startsWith(existing));
});

test("OBJ and repeat exports keep distinct section names, real mesh references and existing INI entries", () => {
  const tags = new Map([["A", new Map([["Collider",true]])]]);
  const roots = objExportHierarchy("o A\ng A_0\no A\no A_2\n", tags);
  const existing = "[General]\nName=Demo\n[Colliders]\nNumberOfMeshColliders=1\nMeshCollider1=Old\n";
  const plan = planExport("demo.obj",roots,all,new Map(),existing);
  assert.equal(plan.count,3);
  assert.match(plan.after,/MeshCollider1=Old/);
  assert.match(plan.after,/NumberOfMeshColliders=3/);
  assert.match(plan.text,/\[A_3\]\nCollider=A\n/);
  assert.equal(planExport("demo.obj",roots,all,new Map(),plan.after).after,plan.after);
  assert.deepEqual(objExportHierarchy("g A B\ng A\n",tags).map(n=>n.name),["A","B"]);
});
