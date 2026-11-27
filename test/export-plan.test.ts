import assert from "node:assert/strict";
import test from "node:test";
import { exportCategories, exportRows, objExportHierarchy, planExport } from "../src/export-plan";
import { assignPaths, type ModelNode } from "../src/hierarchy";
import manifest from "../package.json";
import { meshFlagSetting } from "../src/mesh-flags";
import { modelTags } from "../src/model-tags";
import { orderHierarchy } from "../src/mesh-order";

const all = new Set(exportCategories);
const flags = manifest.contributes.configuration.properties[meshFlagSetting].default;
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
  assert.match(selected.text, /\[Hull\]\nCollider=Hull\nParent=VisibleParent\nPosition=3,0,0/);
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

test("tagged variants generate model settings and collider sections without visible duplicate meshes", () => {
  const tags = new Map([["Frame",new Map([["Collider",true]])], ["Hull_col",new Map([["Collider",false]])]]);
  const roots = objExportHierarchy("o Hull\no Hull_lod1\no Hull_lod2\no Hull_d\no Hull_d1\no Hull_d2\no Frame\no Hull_col",tags);
  const rows = exportRows(roots,tags,flags);
  assert.deepEqual(rows.map(r => r.category),["Mesh","LOD","LOD","Damaged","Damaged","Damaged","Collider","Mesh"]);
  const roles = new Map(rows.map(r => [r.path,r.category]));
  const plan = planExport("ship.obj",roots,all,roles,undefined,[1,2.5]);
  assert.match(plan.text,/LODLevels=2\nLOD1Distance=1\nLOD2Distance=2.5/);
  assert.match(plan.text,/DamageModel1=Hull_d1\nDamageModel2=Hull_d2\nNumberOfDamageModels=2/);
  assert.doesNotMatch(plan.text,/Mesh=Hull_(?:lod|d)/);
  const colliders = planExport("ship.obj",roots,new Set(["Collider"]),roles);
  assert.match(colliders.text,/NumberOfMeshColliders=1\nMeshCollider1=Frame/);
  assert.doesNotMatch(colliders.text,/\[Models\]|\[Submodels\]/);
  const target = "[Models]\r\nNumberOfDamageModels=1\r\nDamageModel1=Previous\r\n";
  const merge = (original:string) => planExport("ship.obj",roots,all,roles,original,[1,2.5]).after;
  assert.match(merge(target),/DamageModel3=Hull_d2/);
  assert.equal(merge(merge(target)),merge(target));
  assert.throws(() => planExport("ship.obj",roots,all,roles,undefined,[2,1]),/increase/);
});

test("main hull, damage and collision roles honor names, triangle counts, shared tags and sibling order", () => {
  const names = ["deck","ship","ship_d","ship_coll_hull","ship_coll_hull_1","fittings"];
  const roots = assignPaths(names.map((name,i) => ({...node(name,"Geometry." + i,0),triangles:[20,60,200,30,12,100][i]})));
  const saved = new Map<string,Map<string,boolean>>();
  const classify = (filename:string) => exportRows(roots,modelTags(roots,filename,saved,flags),flags);
  const rows = classify("ship.fbx");
  assert.deepEqual(rows.map(r=>r.category),["Mesh","Primary mesh","Primary damage mesh","Hull collider","Collider","Mesh"]);
  const roles = new Map(rows.map(r=>[r.path,r.category]));
  const output = planExport("ship.fbx",orderHierarchy(roots,["fittings","ship_coll_hull_1","deck"]),all,roles).text;
  assert.match(output,/ResourcesMesh=ship\nResourcesDamagedMesh=ship_d\nResourcesMeshHullCollider=ship_coll_hull/);
  assert.match(output,/SubModel1=fittings\nSubModel2=deck/);
  assert.match(output,/MeshCollider1=ship_coll_hull_1\nMeshCollider2=ship_coll_hull/);
  assert.doesNotMatch(output,/SubModel\d+=ship\b|Geometry\./);
  saved.set("ship",new Map([["Primary mesh",false]]));
  assert.equal(classify("other.fbx").find(r=>r.category==="Primary mesh")?.name,"fittings");
  saved.set("deck",new Map([["Primary mesh",true]]));
  assert.equal(classify("ship.fbx").find(r=>r.category==="Primary mesh")?.name,"deck");
});
