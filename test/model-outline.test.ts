import { test } from "node:test";
import assert from "node:assert/strict";
import { objLayout, fbxOutline } from "../src/model-outline";
import { applyDisplay } from "../src/preview-display";
import { previewObj } from "../src/obj-geometry";
import { Mesh, MeshPhongMaterial } from "three";
import { type ModelNode, colliderSnippet } from "../src/hierarchy";

test("OBJ objects are peers and shared groups can belong to multiple objects", () => {
  const {nodes} = objLayout("o First\ng A B\nf 1 2 3\no Second\nf 2 3 4\ng A\ng\no Empty\n");
  assert.deepEqual(nodes.map(n => [n.name,n.children.map(c => c.name)]), [
    ["First",["A","B"]], ["Second",["A","B"]], ["Empty",[]]
  ]);
  assert.equal(objLayout("g Group\nf 1 2 3").nodes[0].name, "(unnamed object)");
});

test("OBJ row visibility distinguishes repeated names and overlapping groups", () => {
  const source = "v 0 0 0\nv 1 0 0\nv 0 1 0\no Hull\ng A B\nf 1 2 3\no Hull\ng collider\nf 1 2 3";
  const layout = objLayout(source), model = previewObj(source,layout);
  const [a,b] = layout.nodes;
  assert.equal(a.children[0].parts[0],a.children[1].parts[0]);
  assert.notEqual(a.parts[0].id,b.parts[0].id);
  const categories = new Map(layout.nodes.flatMap(n => n.parts.map(p => [p.id,p.collider] as const)));
  const hidden = new Set([a.parts[0].id]);
  const settings = {meshes:true,colliders:false,wireframe:true};
  applyDisplay(model,categories,hidden,settings);
  assert.deepEqual(model.children.map(m=>m.layers.isEnabled(0)),[false,false]);
  applyDisplay(model,categories,hidden,{...settings,colliders:true});
  assert.deepEqual(model.children.map(m=>m.layers.isEnabled(0)),[false,true]);
});

test("FBX parent visibility and wireframe can change independently of child visibility", () => {
  const material = new MeshPhongMaterial();
  const parent = Object.assign(new Mesh(undefined,material),{ID:1});
  const child = Object.assign(new Mesh(undefined,[material]),{ID:2});
  parent.add(child);
  const categories = new Map([["1",false],["2",true]]);
  applyDisplay(parent,categories,new Set(),{meshes:false,colliders:true,wireframe:true});
  assert.equal(material.wireframe,true);
  assert.ok(child.layers.isEnabled(0) && !parent.layers.isEnabled(0) && parent.visible);
  applyDisplay(parent,categories,new Set(["2"]),{meshes:true,colliders:true,wireframe:false});
  assert.ok(parent.layers.isEnabled(0) && !child.layers.isEnabled(0));
  assert.equal(material.wireframe,false);
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
