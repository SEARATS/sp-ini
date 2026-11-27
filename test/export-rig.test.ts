import assert from "node:assert/strict";
import test from "node:test";
import { LoadingManager, Vector3 } from "three";
import { readExportGeometry } from "../src/export-rig";
import { exportRigScene } from "../src/entity-model";
import { assembledEntity, entityGeometry } from "../src/entity-viewer";
import { exportCategories, exportRows, fitTaggedColliders, objExportHierarchy, planExport, type ExportChoice } from "../src/export-plan";
import { assignPaths } from "../src/hierarchy";
import { parse } from "../src/ini";

test("the rig uses the emitted parent and offset after a helper is skipped and a mesh reclassified", () => {
  const roots = assignPaths([{id:"1",name:"Helper",mesh:"",path:"",position:[1,0,0],children:[
    {id:"2",name:"Body",mesh:"Surface",path:"",position:[2,0,0],children:[]}
  ]}]);
  const {assets} = readExportGeometry("model.obj", Buffer.from("v 0 0 0\nv 1 0 0\nv 0 1 0\ng Surface Shared\nf -3 -2 -1\n"));
  const names = new Map(assets.names), geometry = assets.geometry.map(entityGeometry);
  assert.ok(names.has("Surface") && names.has("Shared"));
  const {text} = planExport("model.obj",roots,new Set(["Collider"]),new Map([["/Helper/Body","Collider"]]));
  const scene = exportRigScene(text,names), view = assembledEntity(scene,new LoadingManager(),geometry);
  assert.deepEqual(scene.warnings,[]);
  assert.equal(view.nodes.has("helper"),false);
  assert.equal(view.nodes.get("body").parent,view.nodes.get("models"));
  assert.deepEqual(view.nodes.get("body").getWorldPosition(new Vector3()).toArray(),[-3,0,0]);
  assert.equal(view.surfaces.get("body").geometry,geometry[names.get("Surface")]);
  assert.match(exportRigScene(text,new Map()).warnings.join(" "),/Missing mesh Surface/);
});

test("box and sphere tags fit referenced OBJ vertices independently of the mesh role and merge both collider lists", () => {
  const source = "v 2 1 0\nv 6 1 0\nv 4 5 2\nv 99 99 99\no Part\nf -4 -3 -2";
  const {bounds} = readExportGeometry("ship.obj",Buffer.from(source));
  const roots = objExportHierarchy(source,new Map());
  const tags = new Map([["Part",new Map([["Box collider",true],["Sphere collider",true]])]]);
  const rows = exportRows(roots,tags);
  assert.equal(rows[0].category,"Mesh");
  const fitted = fitTaggedColliders(rows,() => bounds);
  const run = (role:ExportChoice, original?:string, hits=fitted) => planExport("ship.obj",roots,new Set(exportCategories),new Map([["/Part",role]]),original,[],hits);
  assert.match(run("Mesh").text,/SubModel1=Part/);
  const skipped = run("Skip").text;
  assert.match(skipped,/Collider=Box\nPosition=-4,3,1\nScale=4,4,2/);
  assert.match(skipped,/Collider=Sphere\nPosition=-4,3,1\nScale=6,6,6/);
  assert.match(skipped,/NumberOfColliders=2/);
  assert.doesNotMatch(skipped,/\[Submodels\]|MeshCollider1=/);
  assert.equal(exportRigScene(skipped,new Map()).parts.filter(p=>p.primitive).length,2);
  const target = "[Colliders]\r\nNumberOfColliders=1 ; authored\r\nCollider1=col_Part_box\r\n[col_Part_box]\r\nCollider=Sphere\r\n";
  const combined = run("Collider",target).after;
  assert.match(combined,/NumberOfMeshColliders=1/);
  assert.match(combined,/NumberOfColliders=3 ; authored/);
  assert.match(combined,/Collider2=col_Part_box_2/);
  assert.equal(run("Collider",combined).after,combined);
  assert.equal(run("Skip",combined,[]).after,target);
  assert.equal(parse(run("Collider").text).sections.filter(s=>s.name==="Colliders").length,1);
  const noShapes = planExport("ship.obj",roots,new Set(["Mesh"]),new Map(),undefined,[],fitted);
  assert.doesNotMatch(noShapes.text,/\[Colliders\]/);
});
