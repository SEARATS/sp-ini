import {test} from "node:test";
import assert from "node:assert/strict";
import { Catalog } from "../src/catalog";
import { parse } from "../src/ini";
import { Materials } from "../src/materials";
import { entityObjects, entityParts, expandEntityIni } from "../src/entity-model";
import { selectEntity, paintTexture, entityDocument } from "../src/entity-selection";
import { assembledEntity, patchEntity } from "../src/entity-viewer";
import { Box3, LoadingManager, Mesh, MeshBasicMaterial, Vector3 } from "three";
import type { EntityPart, Vector } from "../src/entity-model";
import { applyDisplay, previewLayer } from "../src/preview-display";
import { hoverStack, sourceLocation } from "../src/entity-inspect";
import {unitCard} from "../src/unit-card";
import {StockAssets} from "../src/stock-assets";
import {systemArcs} from "../src/system-arcs";

test("system arc guides preserve separate firing sectors, wrap past 180 and show elevation",()=>{
  const doc=expandEntityIni("[Models]\nMesh=hull\n[WeaponSystem1]\nMountPosition=0,0,0\nFiringArcs=150,-150|-30,30\nElevationArc=-15,85");
  const [obj]=entityObjects(doc,entityParts(doc,new Set()).map(p=>p.part));
  assert.equal(obj.elevationArc,"-15,85");
  const guide=systemArcs(obj), points=guide.geometry.getAttribute("position");
  const vertices=Array.from({length:points.count},(_,i)=>new Vector3().fromBufferAttribute(points,i));
  assert.ok(vertices.some(p=>p.z < -0.999));
  assert.ok(vertices.some(p=>p.z > 0.999));
  assert.ok(vertices.every(p=>Math.abs(p.x)<0.51));
  assert.ok(vertices.some(p=>p.y>0.99) && vertices.some(p=>p.y < -0.25));
  assert.equal(systemArcs({...obj,firingArcs:"bad",elevationArc:"85,-15"}),undefined);
});

test("unit cards use mod names, inherited particulars and variant profile art in game lookup order",async()=>{
  const catalog=new Catalog(), docs=new Map();
  function add(rel:string,text:string) {
    const uri="file:///stock/"+rel, doc=parse(text);
    catalog.add({rel,uri,source:"Workspace"},doc); docs.set(uri,doc);
  }
  add("language_en/vessel_names/custom.ini","[copy]\nDefault=Custom class\nVariant2=Second ship");
  add("language_en/vessel_names.ini","[copy]\nDefault=Fallback\nType=DD,Destroyer\nDefaultDescription=Stock description");
  add("vessels/base.ini","[General]\nUnitType=Vessel\nLength=120");
  const paths:string[]=[];
  const stock=new StockAssets();
  stock.read=async (_type,_name,scope)=>{paths.push(scope);return scope==="ui/profiles/base_2" ? {png:"image"} as any : undefined;};
  const card=await unitCard({uri:"file:///stock/vessels/copy.ini",text:"#!copy vessels/base.ini\n[Default]\n[Variant2]\n[General]\nLength=123",appearance:"Variant2"},
    catalog,new Materials(uri=>docs.get(uri)),stock);
  assert.ok(!("error" in card));
  assert.equal(card.title,"Second ship"); assert.equal(card.description,"Stock description");
  assert.deepEqual(card.facts,[{label:"Length",value:"123 m"},{label:"Range",value:"0 nm"}]);
  assert.deepEqual(paths,["ui/profiles/copy_2","ui/profiles/copy","ui/profiles/base_2"]);
  assert.equal(card.profile,"image");
});

test("INI trees separate display categories while widgets follow their runtime mounts",()=>{
  const text = ["[Models]","ResourcesMesh=hull","[Submodels]","Sensors_1=Mast","[Mast]","Mesh=Dummy","Position=1,2,3",
    "[Colliders]","Collider1=Box","[Box]","Parent=Mast","Collider=Box","[SensorSystem1]","Mount=Mast","MountPosition=99,99,99",
    "[WeaponSystem2]","Mount=Dummy","MountParent=Mast","MountPosition=4,5,6","AssociatedMagazine=Locker",
    "[Locker]","Collider=Box","[CombatSystem1]","SystemName=Example","[SensorSystem3]","Mount=Missing",
    "[LaunchPoint1]","Position=invalid"].join("\n");
  const doc = expandEntityIni(text,"file:///test.ini");
  const parts = entityParts(doc,new Set()).map(p=>p.part), objects = entityObjects(doc,parts);
  const {model,outline} = assembledEntity({parts,objects,geometry:[],textures:[],warnings:[]},new LoadingManager());
  assert.deepEqual(outline.map(n=>n.name),["Meshes","Colliders","Objects"]);
  assert.deepEqual(outline[0].children[0].children.map(n=>n.name),["Mast"]);
  assert.deepEqual(outline[1].children.map(n=>n.name),["Box"]);
  assert.equal(objects.find(o=>o.name==="Locker").group,"Magazines");
  const widgets = new Map<string,Mesh>();
  model.traverse(node=>{if (node.userData.widget) widgets.set(node.userData.partId,node as Mesh);});
  assert.equal(widgets.size,3);
  assert.deepEqual(widgets.get("object:sensorsystem1").getWorldPosition(new Vector3()).toArray(),[-1,2,3]);
  assert.deepEqual(widgets.get("object:weaponsystem2").getWorldPosition(new Vector3()).toArray(),[-5,7,9]);
  assert.equal(doc.lines[objects.find(o=>o.name==="SensorSystem3").source.line],"[SensorSystem3]");
  assert.ok(outline[2].children.find(n=>n.name==="Combat systems").children.length);
  const settings = {objects:true, meshes:false,colliders:false,meshWireframe:false,colliderWireframe:true};
  applyDisplay(model,new Map(),new Set(["object:sensorsystem1"]),settings);
  assert.ok(widgets.get("object:weaponsystem2").layers.isEnabled(previewLayer.widget));
  assert.equal(widgets.get("object:sensorsystem1").layers.mask,0);
  applyDisplay(model,new Map(),new Set(),{...settings,objects:false});
  assert.equal(widgets.get("object:weaponsystem2").layers.mask,0);
});

test("referenced colliders use their owners' colors and replace markers only while visible",()=>{
  const doc = expandEntityIni(["[Models]","Mesh=hull","ResourcesMeshHullCollider=chassis","[Colliders]","Collider1=A","Collider2=B","Collider3=C",
    "Collider4=coll_hull1a","Collider5=LockerBox","MeshCollider1=Shell","[Shell]","Collider=chassis","[A]","Collider=Box","[B]","Collider=Sphere","[C]","Collider=Box",
    "[coll_hull1a]","Collider=Box","[LockerBox]","Collider=Box","[SensorSystem1]","MountPosition=1,2,3","Collider=a, B",
    "[WeaponSystem1]","MountPosition=4,5,6","AssociatedMagazine=Locker","Collider=B","[Locker]","Collider=b,LockerBox"].join("\n"));
  const parts=entityParts(doc,new Set()).map(p=>p.part);
  const {model,outline}=assembledEntity({parts,objects:entityObjects(doc,parts),geometry:[],textures:[],warnings:[]},new LoadingManager());
  assert.deepEqual(parts.find(p=>p.id==="b").referencedBy,["SensorSystem1","WeaponSystem1","Locker"]);
  assert.deepEqual(outline[1].children.map(r=>r.colliderStyle),["sensor","weapon","unassigned","hull","magazine","hull"]);
  for (const [name,color] of [["A",0x53c8fa],["B",0xff4444],["C",0xc0c0c0],["coll_hull1a",0xffffff],["LockerBox",0xff833d]] as const) {
    const mesh=model.getObjectByName(name).children[0];
    assert.ok(mesh instanceof Mesh && mesh.material instanceof MeshBasicMaterial);
    assert.equal(mesh.material.color.getHex(),color);
  }
  const widgets = new Map<string,Mesh>();
  model.traverse(n=>{if(n.userData.widget) widgets.set(n.userData.partId,n as Mesh);});
  const settings={meshes:true,colliders:true,objects:true,meshWireframe:false,colliderWireframe:true};
  const categories=new Map(parts.map(p=>[p.id,p.collider]));
  applyDisplay(model,categories,new Set(),settings);
  assert.equal(widgets.get("object:sensorsystem1").layers.mask,0);
  const hit = (name:string) => ({object:model.getObjectByName(name).children[0]});
  const byId = new Map(parts.map(part=>[part.id,part]));
  const ordered = hoverStack(["C","LockerBox","A","coll_hull1a","B","B","C"].map(hit),byId);
  assert.deepEqual(ordered.map(p=>p.id),["b","lockerbox","a","coll_hull1a","c"]);
  applyDisplay(model,categories,new Set(["b"]),settings);
  assert.equal(widgets.get("object:sensorsystem1").layers.mask,0);
  assert.ok(widgets.get("object:weaponsystem1").layers.isEnabled(previewLayer.widget));
});

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

test("sphere colliders use their scaled in-game size and keep their full extents",()=>{
  function sphere(id: string, scale: Vector, parent?: string): EntityPart {
    return {id,name:id,parent,scale,primitive:"sphere",collider:true,visible:true,position:[0,0,0],rotation:[0,0,0]};
  }
  const parts = [sphere("small",[0.04,0.04,0.04]),sphere("nested",[-0.025,0.025,0.025],"mount"),
    sphere("large",[0.2,0.2,0.2]),sphere("oversized",[2,2,2]),sphere("flat",[0,0,0]),
    {...sphere("mount",[4,2,1]),primitive:undefined}];
  const {model} = assembledEntity({parts,geometry:[],textures:[],warnings:[]},new LoadingManager());
  const surface = (name: string) => model.getObjectByName(name).children[0] as Mesh;
  const triangles = (name: string) => surface(name).geometry.getAttribute("position").count / 3;
  assert.deepEqual(["small","nested","large","oversized","flat"].map(triangles),[8,32,128,128,8]);
  const size = new Box3().setFromObject(surface("nested"),true).getSize(new Vector3());
  assert.ok(size.distanceTo(new Vector3(0.1,0.05,0.025)) < 1e-6);
});

test("editing a transform moves the existing collider without replacing its geometry",()=>{
  const doc = expandEntityIni("[Models]\nMesh=hull\n[Colliders]\nCollider1=Part\n[Part]\nCollider=Sphere");
  const scene = {parts:entityParts(doc,new Set()).map(p=>p.part),objects:[],geometry:[],textures:[],warnings:[]};
  const view = assembledEntity(scene,new LoadingManager()), original=view.surfaces.get("part").geometry;
  const edit=structuredClone(scene);
  edit.parts[1].position=[1,2,3];
  assert.ok(patchEntity(view,scene,edit));
  assert.equal(view.surfaces.get("part").geometry,original);
  assert.deepEqual(view.nodes.get("part").position.toArray(),[-1,2,3]);
  edit.parts[1].scale=[2,2,2];
  assert.equal(patchEntity(view,scene,edit),false);
});

test("preview links retain source headers through repeats and inheritance",async()=>{
  const uri="file:///aircraft/base.ini", derived="file:///aircraft/derived.ini";
  const text="[Models]\nResourcesMesh=hull\n[Submodels]\nSubmodel1=Part2\n[Colliders]\nCollider1=Tip\n#!repeat i=1|2\n[Part{i}]\nMesh=part\n#!end\n[Tip]\nCollider=Sphere";
  const catalog=new Catalog(), doc=parse(text);
  catalog.add({uri,rel:"aircraft/base.ini",source:"Workspace"},doc);
  const merged=await entityDocument("#!copy aircraft/base.ini\n\n[Tip]\nScale=1,1,1",derived,catalog,new Materials(()=>doc));
  const sources=entityParts(merged,new Set()).map(p=>p.part.source);
  assert.deepEqual(sources,[{uri,line:0,header:"Models"},{uri,line:7,header:"Part{i}"},{uri:derived,line:2,header:"Tip"}]);
  assert.deepEqual(sources.map(source=>sourceLocation(source,derived)),["base.ini · line 1","base.ini · line 8","line 3"]);
  assert.deepEqual(expandEntityIni(text,uri).sections.at(-1).source,{uri,line:10,header:"Tip"});
});
