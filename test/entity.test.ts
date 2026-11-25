import {test} from "node:test";
import assert from "node:assert/strict";
import { Catalog } from "../src/catalog";
import { parse } from "../src/ini";
import { Materials } from "../src/materials";
import { entityParts, expandEntityIni } from "../src/entity-model";
import { selectEntity, paintTexture } from "../src/entity-selection";
import { assembledEntity } from "../src/entity-viewer";
import { LoadingManager, Vector3 } from "three";

test("entity picker resolves each scenario declaration and its own squadron or variant", async () => {
  const catalog = new Catalog(), docs = new Map();
  function add(rel: string,text: string) {
    const uri = "file:///content/"+rel, doc=parse(text);
    catalog.add({uri,rel,source:"Workspace"},doc); docs.set(uri,doc);
  }
  add("aircraft/plane.ini","[General]\nUnitType=Aircraft\n[Models]\nResourcesMesh=airframe");
  add("vessels/ship.ini","[General]\nUnitType=Vessel\n[Models]\nResourcesMesh=hull");
  add("aircraft/plane_squadrons.ini","[Default]\nResourcesLiveryFolder=aircraft/paint\n[Squadron1]\nLiveryTexture=one\n[Squadron2] # Second squadron\nLiveryTexture=two");
  const materials = new Materials(uri=>docs.get(uri));
  const request = {text:"[Taskforce1Vessel1]\nType=ship\n[Taskforce2Aircraft1]\nType=plane\nSquadronReference=Squadron2",uri:"file:///content/missions/demo.ini"};
  const ship = await selectEntity(request,catalog,materials);
  assert.equal(ship.entities.length,2);
  assert.match(ship.sourceText,/ResourcesMesh=hull/);
  const plane = await selectEntity({...request,entity:"Taskforce2Aircraft1"},catalog,materials);
  assert.match(plane.sourceText,/ResourcesMesh=airframe/);
  assert.equal(plane.appearance,"Squadron2");
  assert.equal(paintTexture(plane.paint,"models",true),"aircraft/paint/two");
  const first = await selectEntity({...request,entity:plane.entity,appearance:"Squadron1"},catalog,materials);
  assert.equal(paintTexture(first.paint,"models",true),"aircraft/paint/one");
});

test("repeat expansion retains distinct model instances and nested local transforms",()=>{
  const text = "[Models]\nResourcesMesh=hull\n[Submodels]\nSubmodel1=Pivot\n#!repeat i=1|2\nSubmodel_{i}=Part{i}\n#!end\n[Pivot]\nMesh=Dummy\nRotation=0,90,0\n#!repeat i=1|2 z=2|4\n[Part{i}]\nMesh=shared\nParent=Pivot\nPosition=0,0,{z}\n#!end";
  const warnings=new Set<string>();
  const parts=entityParts(expandEntityIni(text),warnings);
  assert.deepEqual(parts.map(({mesh})=>mesh.value),["hull","Dummy","shared","shared"]);
  assert.deepEqual(parts[3].part.position,[0,0,4]);
  assert.equal(parts[3].part.parent,"pivot");
  assert.deepEqual([...warnings],[]);
  const {model}=assembledEntity({parts:parts.map(p=>p.part),geometry:[],textures:[],warnings:[]},new LoadingManager());
  const nested = model.getObjectByName("Part2");
  assert.equal(nested.parent.name,"Pivot");
  assert.ok(nested.getWorldPosition(new Vector3()).distanceTo(new Vector3(-4,0,0))<1e-6);
});
