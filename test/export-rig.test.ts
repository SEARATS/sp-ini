import assert from "node:assert/strict";
import test from "node:test";
import { LoadingManager, Vector3 } from "three";
import { exportRigAssets } from "../src/export-rig";
import { exportRigScene } from "../src/entity-model";
import { assembledEntity, entityGeometry } from "../src/entity-viewer";
import { planExport } from "../src/export-plan";
import { assignPaths } from "../src/hierarchy";

test("the rig uses the emitted parent and offset after a helper is skipped and a mesh reclassified", () => {
  const roots = assignPaths([{id:"1",name:"Helper",mesh:"",path:"",position:[1,0,0],children:[
    {id:"2",name:"Body",mesh:"Surface",path:"",position:[2,0,0],children:[]}
  ]}]);
  const assets = exportRigAssets("model.obj", Buffer.from("v 0 0 0\nv 1 0 0\nv 0 1 0\ng Surface Shared\nf -3 -2 -1\n"));
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
