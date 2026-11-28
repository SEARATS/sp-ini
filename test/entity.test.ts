import {test} from "node:test";
import assert from "node:assert/strict";
import { Catalog } from "../src/catalog";
import { parse } from "../src/ini";
import { Materials } from "../src/materials";
import { entityObjects, entityParts, expandEntityIni } from "../src/entity-model";
import { selectEntity, paintTexture, entityDocument } from "../src/entity-selection";
import { assembledEntity, bindEntitySpins, entityBounds, patchEntity, poseElevator } from "../src/entity-viewer";
import { entitySpins } from "../src/entity-spins";
import { elevatorTravel } from "../src/elevator-travel";
import { Box3, Group, LoadingManager, Mesh, MeshBasicMaterial, Vector3 } from "three";
import type { EntityPart, Vector } from "../src/entity-model";
import { applyDisplay, previewLayer } from "../src/preview-display";
import { hoverStack, sourceLocation } from "../src/entity-inspect";
import {unitCard} from "../src/unit-card";
import {CardReferences} from "../src/card-references";
import {StockAssets} from "../src/stock-assets";
import {placeSystemArcs,systemArcs} from "../src/system-arcs";
import { entityModes, excludedOverlays } from "../src/entity-mode";

test("active spins resolve sensor overrides, skip stationary mounts and turn rotor children around the local axis",async()=>{
  const catalog = new Catalog(), docs = new Map<string,ReturnType<typeof parse>>();
  catalog.sourceRanks = new Map([["Workspace",0],["Vanilla",1]]);
  function sensors(source:string, text:string) {
    const rel = "systems/sensors.ini", uri = "file:///"+source+"/"+rel, doc = parse(text);
    catalog.add({source,rel,uri},doc);
    docs.set(uri,doc);
  }
  sensors("Vanilla","[Nav]\nType=Search\nRPM=12\n[Array]\nType=Search\nRPM=0\n[Director]\nType=Targeting\nRPM=60\n[Fallback]\nType=Search");
  sensors("Workspace","#!extend systems/sensors.ini\n[Nav]\nRotationDirection=-1\nRPM=30");
  const doc = parse(["[Models]","Mesh=Hull","[Submodels]","SubModel1=Mast","SubModel2=Hub","SubModel3=Blade",
    "SubModel4=Array","SubModel5=Director","SubModel6=Second","[Mast]","[Hub]","Rotation=90,0,0","[Blade]","Parent=Hub",
    "Position=1,0,0","[Array]","[Director]","[Second]","[FlightControls]","NumberOfRotors=1","Rotor1_Model=Hub",
    "Rotor1_Direction=-1","Rotor1_RPM=15","Rotor1_RotationAxis=Z","Rotor2_Model=Blade",
    ...[["Nav","Mast"],["Nav","MAST"],["Array","Array"],["Director","Director"],["Nav","Dummy"],["Fallback","Second"]]
      .flatMap(([name,mount],i)=>["[SensorSystem"+(i+1)+"]","Type=Radar","SystemName="+name,"Mount="+mount])].join("\n"));
  const parts = entityParts(doc,new Set()).map(row=>row.part);
  const spins = await entitySpins(doc,parts,catalog,new Materials(uri=>docs.get(uri)));
  assert.deepEqual(spins,[{part:"hub",axis:"z",rpm:-15},{part:"mast",axis:"y",rpm:-30},{part:"second",axis:"y",rpm:15}]);
  const view = assembledEntity({parts,geometry:[],textures:[],warnings:[]},new LoadingManager());
  const sample = bindEntitySpins(view.nodes,spins);
  const blade = view.nodes.get("blade"), mast = view.nodes.get("mast");
  sample(1);
  assert.ok(blade.getWorldPosition(new Vector3()).distanceTo(new Vector3(0,0,-1))<1e-6);
  sample(0.5);
  sample(0.5);
  assert.ok(new Vector3(0,0,1).applyQuaternion(mast.quaternion).distanceTo(new Vector3(1,0,0))<1e-6);
  sample(0);
  assert.ok(blade.getWorldPosition(new Vector3()).distanceTo(new Vector3(-1,0,0))<1e-6);
  assert.equal(bindEntitySpins(view.nodes,[]),undefined);
});

test("preview modes keep the model and match shared colliders to each owning system", () => {
  const doc = expandEntityIni(["[Models]", "Mesh=hull", "[Colliders]", "Collider1=Shared", "Collider2=Deck",
    "Collider3=Unassigned", "[Shared]", "Collider=Box", "[Deck]", "Collider=Box", "[Unassigned]", "Collider=Box",
    "[WeaponSystem1]", "Collider=Shared", "AssociatedMagazine=Locker", "[Locker]", "[SensorSystem1]", "Collider=SHARED",
    "[FlightDeck]", "Collider=Deck", "[TaxiPoint1]", "Position=1,2,3", "[Elevator2]", "[PropulsionSystem1]",
    "[RudderSystem2]", "[MainPowerSystem]", "[ControlSystem]"].join("\n"));
  const parts = entityParts(doc,new Set()).map(row=>row.part);
  const objects = entityObjects(doc,parts);
  const scene = {parts,objects,geometry:[],textures:[],warnings:[]};
  const visible = entityModes.map(mode => {
    const excluded = excludedOverlays(scene,mode);
    assert.ok(!excluded.has("models"));
    return [...parts,...objects].map(item=>item.id).filter(id=>id!=="models" && !excluded.has(id));
  });
  assert.equal(visible[0].length,parts.length+objects.length-1);
  assert.deepEqual(visible.slice(1),[
    ["shared","object:weaponsystem1","object:locker"],
    ["deck","object:flightdeck","object:taxipoint1","object:elevator2"],
    ["shared","object:sensorsystem1"],
    ["object:propulsionsystem1","object:ruddersystem2","object:mainpowersystem"]
  ]);
});

test("deck squares and taxi ribbons use authored positions and update when a waypoint moves",()=>{
  const ini = ["[Models]","Mesh=hull","[FlightDeck]","NumberOfTaxiPaths=4",
    "[Elevator1]","SpawnPosition=0,1,0","RidePosition=0,2,1","RecoveryPosition=0,2,2",
    "[LaunchPoint1]","Position=1,2,3","[TaxiPath1]","From=Elevator1","To=LaunchPoint1","Waypoints=1,2,1|1,2,2",
    "[TaxiPath2]","From=LaunchPoint1","To=Elevator1","[TaxiPath3]","From=Missing","To=Elevator1",
    "[TaxiPath4]","From=Elevator1","To=LaunchPoint1","Waypoints=1,,3","[TaxiPath5]","From=Elevator1","To=LaunchPoint1"].join("\n");
  function scene(text:string) {
    const doc=parse(text), parts=entityParts(doc,new Set()).map(p=>p.part);
    return {parts,objects:entityObjects(doc,parts),geometry:[],textures:[],warnings:[]};
  }
  const before = scene(ini), view=assembledEntity(before,new LoadingManager());
  const route = before.objects.find(o=>o.name==="TaxiPath1"), id=route.id;
  assert.deepEqual(route.route.points,[[0,2,1],[1,2,1],[1,2,2],[1,2,3]]);
  assert.deepEqual(before.objects.find(o=>o.name==="TaxiPath2").route.points,[[1,2,3],[0,2,2]]);
  const lift = view.widgets.get("object:elevator1");
  assert.ok(lift.position.equals(new Vector3(0,1,0)));
  lift.geometry.computeBoundingBox();
  assert.ok(lift.geometry.boundingBox.getSize(new Vector3()).y < 1e-6);
  const path = view.widgets.get(id), previous = path.geometry;
  assert.equal(previous.index.count,18);
  for (const index of [3,4,5]) assert.ok(!view.widgets.has("object:taxipath"+index));
  assert.ok(patchEntity(view,before,scene(ini.replace("1,2,1|","2,2,1|"))));
  assert.notEqual(path.geometry,previous);
  assert.equal(view.widgets.get(id),path);
  assert.ok(!excludedOverlays(before,"Flight").has(id) && excludedOverlays(before,"Sensors").has(id));
});

test("flight paths use raised elevators, deck-relative air coordinates and independent visibility",async()=>{
  const doc = parse(["[Models]","Mesh=hull","[Submodels]","SubModel1=Elevator_1","[Elevator_1]","Mesh=lift",
    "[FlightDeck]","NumberOfElevators=1","NumberOfRecoveryPoints=1","NumberOfTaxiPaths=2",
    "HoldWaypoints=1,100,0|0,100,1","[RecoveryPoint1]","Position=1,2,3","Rotation=90","AllowedType=Plane,Helicopter",
    "CircuitWaypoints=1,100,0","[Elevator1]","SpawnPosition=0,0,0","RidePosition=0,0,1","MoveUpAnimation=Lift",
    "[TaxiPath1]","From=Elevator1","Waypoints=0,999,0","To=RecoveryPoint1","[TaxiPath2]","From=RecoveryPoint1","Waypoints=0,-999,0","To=Elevator1",
    "[Animations]","AnimationFile_1=DeckLift"].join("\n"));
  const library = parse("[Animations]\nAnimation1=Lift\n[Lift]\nSequence1=Up\nSequence1_Model=Elevator_1\n[Up]\nNumberOfSteps=2\nPositionY1=-1.75\nStep2=8|none,0,none|none|linear");
  const catalog = new Catalog(), uri="file:///animations/DeckLift.ini";
  catalog.add({rel:"animations/DeckLift.ini",source:"Workspace",uri},library);
  const parts = entityParts(doc,new Set()).map(r=>r.part), warnings=new Set<string>();
  const elevators = await elevatorTravel(doc,parts,catalog,new Materials(()=>library),warnings);
  assert.equal(warnings.size,0);
  const objects=entityObjects(doc,parts,elevators);
  const get=(name:string)=>objects.find(o=>o.name===name);
  assert.deepEqual(get("Elevator1").position,[0,0,0]);
  assert.deepEqual(get("TaxiPath1").position,[0,1.75,1]);
  assert.deepEqual(get("TaxiPath2").route.points.at(-1),[0,2,1]);
  const hold=get("FlightDeck · HoldWaypoints"), approach=get("RecoveryPoint1 · Fixed-wing approach");
  assert.deepEqual(hold.route.points,[[27.559496,100*0.00453571,0],[0,100*0.00453571,27.559496],hold.position]);
  assert.equal(approach.route.points.length,6);
  assert.ok(Math.abs(approach.route.points[0][1]-100*27.559496*0.000189394)<1e-8);
  assert.ok(Math.abs(approach.route.points[1][0]-(1-2*27.559496))<1e-8);
  assert.deepEqual(approach.route.points.at(-1),[1,2,3]);
  assert.equal(get("RecoveryPoint1 · Helicopter approach").route.points.length,3);
  const scene={parts,objects,elevators,geometry:[],textures:[],warnings:[]};
  const view=assembledEntity(scene,new LoadingManager());
  poseElevator(view,scene,"Elevator1/raise/0");
  assert.equal(view.nodes.get("elevator_1").position.y,-1.75);
  poseElevator(view,scene,"Elevator1/raise/1");
  assert.equal(view.nodes.get("elevator_1").position.y,0);
  poseElevator(view,scene,"Elevator1/raise/0");
  poseElevator(view,scene,"");
  assert.equal(view.nodes.get("elevator_1").position.y,0);
  for (const obj of [hold,get("TaxiPath1")]) {
    const material=view.widgets.get(obj.id).material;
    assert.ok(!Array.isArray(material) && !material.depthTest);
  }
  const missing=await elevatorTravel(doc,parts,new Catalog(),new Materials(()=>undefined),warnings);
  assert.ok([...warnings].some(w=>w.includes("MoveUpAnimation=Lift")));
  assert.deepEqual(entityObjects(doc,parts,missing).find(o=>o.name==="TaxiPath1").position,[0,0,1]);
  const hits = [hold,get("TaxiPath1"),get("RecoveryPoint1")].map(obj=>({object:view.widgets.get(obj.id)}));
  assert.equal(hoverStack(hits,new Map(objects.map(obj=>[obj.id,obj])))[0].id,get("RecoveryPoint1").id);
  const settings={meshes:true,colliders:true,objects:false,meshWireframe:false,colliderWireframe:true};
  for (const airPaths of [false,true]) for (const taxiPaths of [false,true]) {
    applyDisplay(view.model,new Map(),new Set(),{...settings,airPaths,taxiPaths});
    assert.equal(view.widgets.get(hold.id).layers.isEnabled(previewLayer.route),airPaths);
    assert.equal(view.widgets.get(get("TaxiPath1").id).layers.isEnabled(previewLayer.route),taxiPaths);
    assert.equal(entityBounds(view.model,true).radius>entityBounds(view.model).radius,airPaths);
  }
});

test("elevator rides follow the platform parent and reject unregistered animations",async()=>{
  const doc=parse("[Models]\nSubModel1=Base\nSubModel2=Lift\n[Base]\nRotation=0,0,90\nScale=2,2,2\n[Lift]\nParent=Base\nMesh=platform\n[FlightDeck]\nNumberOfElevators=1\n[Elevator1]\nMesh=Lift\nRidePosition=0,0,0\nMoveUpAnimation=Raise\nMoveDownAnimation=Lower\n[Animations]\nAnimationFile_1=platform");
  const lib=parse("[Animations]\nNumberOfAnimations=1\nAnimation1=Raise\nAnimation2=Lower\n[Raise]\nSequence1_Model=Lift\nSequence1=Motion\n[Lower]\nSequence1_Model=Lift\nSequence1=Motion\n[Motion]\nNumberOfSteps=2\nTime1=0\nPositionY1=0\nTime2=8\nPositionY2=1");
  const catalog=new Catalog(), warnings=new Set<string>();
  catalog.add({rel:"animations/platform.ini",uri:"file:///animations/platform.ini",source:"Workspace"},lib);
  const parts=entityParts(doc,warnings).map(({part})=>part);
  const [lift]=await elevatorTravel(doc,parts,catalog,new Materials(()=>lib),warnings);
  assert.ok(new Vector3(...lift.raisedRide).distanceTo(new Vector3(-2,0,0))<1e-10);
  assert.deepEqual(lift.lower,[]);
  assert.deepEqual([...warnings],["[Elevator1] MoveDownAnimation=Lower is not a registered animation."]);
});

test("system arc guides preserve separate firing sectors, wrap past 180 and show elevation",()=>{
  const doc=expandEntityIni("[Models]\nMesh=hull\n[WeaponSystem1]\nMountPosition=0,0,0\nFiringArcs=150,-150|-30,30\nElevationArc=-15,85");
  const [obj]=entityObjects(doc,entityParts(doc,new Set()).map(p=>p.part));
  assert.equal(obj.elevationArc,"-15,85");
  const guides=systemArcs(obj);
  assert.deepEqual(guides.map(g=>g.color),[0xff8c32,0xffb368]);
  const vertices=(line:typeof guides[number]["line"])=>{
    const points=line.geometry.getAttribute("position");
    return Array.from({length:points.count},(_,i)=>new Vector3().fromBufferAttribute(points,i));
  };
  const bearing=vertices(guides[0].line), elevation=vertices(guides[1].line);
  assert.ok(bearing.some(p=>p.z < -0.999) && bearing.some(p=>p.z > 0.999));
  assert.ok(bearing.every(p=>Math.abs(p.x)<0.51));
  assert.ok(elevation.some(p=>p.y>0.99) && elevation.some(p=>p.y < -0.25));
  assert.deepEqual(systemArcs({...obj,firingArcs:undefined,elevationArc:"85,-15"}),[]);

  // Stock Spruance aft mount: a turned submodel and an already aft-facing sector.
  const aft=systemArcs({...obj,firingArcs:"60,-60"});
  const unit=new Group(), mount=new Group();
  unit.position.set(2,0,3); mount.position.set(0,1,-2); mount.rotation.y=Math.PI; unit.add(mount);
  placeSystemArcs(aft,unit,mount,1);
  assert.ok(aft[0].line.position.equals(new Vector3(2,1,1)));
  assert.ok(aft[1].line.position.equals(new Vector3(2,1,1)));
  assert.ok(vertices(aft[0].line).some(p=>p.applyQuaternion(aft[0].line.quaternion).z < -0.999));
  assert.ok(vertices(aft[0].line).every(p=>p.applyQuaternion(aft[0].line.quaternion).z < 0.501));
  assert.ok(vertices(aft[1].line).some(p=>p.applyQuaternion(aft[1].line.quaternion).z < -0.99));
  const ring=systemArcs({...obj,firingArcs:"360,360|10,20"})[0];
  assert.ok(vertices(ring.line).every(p=>p.length()>0.99));
  assert.equal(vertices(systemArcs({...obj,firingArcs:"0"})[0].line).length,vertices(ring.line).length);
  const laterZero=systemArcs({...obj,firingArcs:"330,30|0,0"})[0];
  assert.ok(vertices(laterZero.line).every(p=>p.z>=0));
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
  assert.deepEqual(card.facts,[{label:"Length",value:"123 m"}]);
  assert.deepEqual(paths,["ui/profiles/copy_2","ui/profiles/copy","ui/profiles/base_2"]);
  assert.equal(card.profile,"image");
});

test("card reach uses the preferred ammunition definition and links each role to its longest configured range",async()=>{
  const catalog=new Catalog(), docs=new Map<string,ReturnType<typeof parse>>();
  catalog.sourceRanks=new Map([["Workspace",0],["Vanilla",1]]);
  function add(source:string,rel:string,ini:string) {
    const uri="file:///"+source+"/"+rel, doc=parse(ini);
    catalog.add({source,rel,uri},doc); docs.set(uri,doc);
    return uri;
  }
  const round=(nm:number)=>"[General]\nTargetType=ASuW\nSecondaryTargetType=AAW\n[Guidance]\nMaxLaunchRange="+nm;
  add("Vanilla","ammunition/first.ini",round(40));
  const override=add("Workspace","ammunition/first.ini",round(9));
  add("Vanilla","ammunition/second.ini",round(16).replace("SecondaryTargetType=AAW",""));
  const sensor=add("Vanilla","systems/sensors.ini","[Example]\nKind=Radar\nType=Search\nRole=Air\nMaxRange=18.52\n[Invalid]\nKind=Sonar\nPassiveRange=-4");
  const refs=new CardReferences(catalog,new Materials(uri=>docs.get(uri)));
  const first=refs.item("ammunition","first","Shared label"), second=refs.item("ammunition","second","Shared label");
  const radar=refs.item("sensors","Example","Example"); refs.item("sensors","Invalid","Invalid");
  const ranges=await refs.resolve();
  assert.deepEqual(ranges.map(r=>[r.label,Math.round(r.nm),r.topic]),[
    ["Air search",10,radar.topic],["Anti-air",9,first.topic],["Anti-surface",16,second.topic]]);
  assert.equal(refs.topics[first.topic].source.uri,override);
  assert.deepEqual(refs.topics[radar.topic].source,{uri:sensor,line:0,header:"Example"});
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
  for (const [name,color] of [["A",0xffdc52],["B",0xff4444],["C",0xc0c0c0],["coll_hull1a",0xffffff],["LockerBox",0xff833d]] as const) {
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
