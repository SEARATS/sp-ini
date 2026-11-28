import test from "node:test";
import assert from "node:assert/strict";
import { entityObjects, entityParts, expandEntityIni, type EntityScene, type Vector } from "../src/entity-model";
import { LoadingManager, Vector3 } from "three";
import { assembledEntity, poseElevator } from "../src/entity-viewer";
import { parse } from "../src/ini";
import { Catalog } from "../src/catalog";
import { Materials } from "../src/materials";
import { carrierAircraft } from "../src/entity-assets";
import { airGroupPerformance, flightSpeed } from "../src/flight-speeds";
import { DeckPlayback, FlightNetwork, flightDeckLayout } from "../src/flight-traffic";

const ini=`[Models]
ResourcesMesh=Hull
[FlightDeck]
NumberOfElevators=1
NumberOfLaunchPoints=2
NumberOfRecoveryPoints=2
NumberOfTaxiPaths=2
LaunchDelay=0
SpawnInterval=0.1
VTOLInitialWaypoint=0,500,1
HelicopterInitialWaypoint=1,100,0
[Elevator1]
AssociatedLaunchPoints=1
SpawnPosition=0,0,0
[LaunchPoint1]
Position=1,0,1
AllowedType=Helicopter,VTOL
VTOL_Ascend=0.42
BlocksRecoveryPoints=1
[LaunchPoint2]
Position=4,0,0
AllowedType=Helicopter
[RecoveryPoint1]
Position=1,0,1
AllowedType=Helicopter,VTOL
AssociatedElevators=1
LandingInterval=0
[RecoveryPoint2]
Position=2,0,1
AllowedType=Helicopter
LandingInterval=0
[TaxiPath1]
From=Elevator1
To=LaunchPoint1
[TaxiPath2]
From=RecoveryPoint1
To=Elevator1`;
function network(text:string) {
  const doc=expandEntityIni(text), parts=entityParts(doc,new Set()).map(d=>d.part);
  const scene:EntityScene={parts,objects:entityObjects(doc,parts),warnings:[],geometry:[],textures:[]};
  return new FlightNetwork(flightDeckLayout(doc,scene),scene.objects);
}
test("selected taxi paths highlight endpoints and select only connected, directed operations",()=>{
  const net=network(ini);
  const related=net.links.get("object:taxipath1");
  assert.ok(related.has("object:elevator1") && related.has("object:launchpoint1") && related.has("object:taxipath2"));
  assert.ok(!related.has("object:recoverypoint2"));
  const p=new DeckPlayback(net,"object:taxipath1"), seen=[];
  let current;
  for(let i=0;i<5000;i++){
    p.tick(0.1);
    assert.ok(p.flights.length<=1);
    const f=p.flights[0];
    if (f && f!==current) {seen.push(f.trip.craft);assert.equal(f.trip.operation,"launch");current=f;}
  }
  assert.deepEqual(seen.slice(0,4),["vtol","helicopter","vtol","helicopter"]);
  const [vtol,heli]=net.trips("object:launchpoint1");
  assert.equal(vtol.legs.at(-1)[1][1],0.42);
  assert.notDeepEqual(vtol.legs.at(-1).at(-1),heli.legs.at(-1).at(-1));
  const rolling=network(ini.replace("AllowedType=Helicopter,VTOL","AllowedType=Plane,VTOL")).trips("object:launchpoint1")[0];
  assert.equal(rolling.craft,"vtol");
  assert.deepEqual(rolling.legs.at(-1)[1],[1,0,8]);
  assert.deepEqual(net.trips("object:taxipath2").map(t=>t.operation),["recovery","recovery"]);
  const lift=new DeckPlayback(net,"object:elevator1"), ops=[];
  for(let i=0;i<5000;i++) {
    lift.tick(0.1); const f=lift.flights[0];
    if(f && current!==f) {ops.push(f.trip.operation);current=f;}
  }
  assert.deepEqual(ops.slice(0,4),["launch","recovery","launch","recovery"]);
});
test("fleet playback fills independent stations, honors reciprocal blocks and alternates modes",()=>{
  const loose=ini.replace("NumberOfElevators=1","NumberOfElevators=0");
  for (const mixed of [true,false]) {
    const play=new DeckPlayback(network(loose.replace("LaunchDelay=0","LaunchDelay=0\nLandingWhileLaunching="+mixed)));
    let most=0,mixedSeen=false;
    const phases=new Set<string>();
    for (let i=0;i<5000;i++) {
      play.tick(0.1);most=Math.max(most,play.flights.length);
      const points=play.flights.filter(f=>f.stationHeld).map(f=>f.trip.station.name);
      assert.ok(!(points.includes("launchpoint1") && points.includes("recoverypoint1")));
      const operations=play.flights.map(f=>f.trip.operation);
      operations.forEach(o=>phases.add(o));
      if(new Set(operations).size>1)mixedSeen=true;
    }
    assert.deepEqual(phases,new Set(["launch","recovery"]));
    assert.equal(mixedSeen,mixed);
    if(mixed) assert.ok(most>=2);
  }
});

test("riders stay on the sampled platform during launch and recovery, including holds and empty returns",()=>{
  const doc=expandEntityIni(ini.replaceAll("Position=1,0,1","Position=1,2,1").replace("ResourcesMesh=Hull","ResourcesMesh=Hull\nSubModel1=Lift\n[Lift]\nMesh=platform")
    .replace("SpawnPosition=0,0,0","SpawnPosition=1,0,0\nRidePosition=1,0,0\nRecoveryPosition=0,2,-1\nDespawnPosition=2,0,0"));
  const parts=entityParts(doc,new Set()).map(r=>r.part), part=parts.find(p=>p.id==="lift");
  const pose=(time:number,y:number,angle:number)=>({time,position:[0,y,0] as Vector,rotation:[0,angle,0] as Vector});
  const lift={name:"Elevator1",part:part.id,raise:[pose(0,0,0),pose(2,0,0),pose(6,2,90)],
    lower:[pose(0,2,90),pose(3,0,0)],raisedRide:[0,2,-1] as Vector};
  const scene:EntityScene={parts,elevators:[lift],objects:entityObjects(doc,parts,[lift]),geometry:[],textures:[],warnings:[]};
  const net=new FlightNetwork(flightDeckLayout(doc,scene),scene.objects,scene);
  const view=assembledEntity(scene,new LoadingManager()), platform=view.nodes.get(part.id), animate=poseElevator(view,part,lift,"animate");
  for (const [focus,motion] of [["launchpoint1","raise"],["recoverypoint1","lower"]] as const) {
    const play=new DeckPlayback(net,"object:"+focus);
    let onPlatform=0,returning=false;
    for (let i=0;i<12000;i++) {
      play.tick(0.05);
      const flight=play.flights[0], current=play.elevators.get("elevator1");
      assert.ok(current);
      if (current.motion!==motion) {
        if (onPlatform) {returning=true;break;}
        continue;
      }
      if (!flight || flight.leg!==flight.trip.ride.leg) continue;
      animate(current.time,current.motion);
      const actual=new Vector3(-1,0,0).applyQuaternion(platform.quaternion).add(platform.position);
      const [x,y,z]=flight.position;
      assert.ok(actual.distanceTo(new Vector3(-x,y,z))<1e-7);
      onPlatform++;
    }
    assert.ok(onPlatform>40,motion);
    assert.ok(returning);
  }
});

test("deck speed uses knots, taxi path flags and embarked helicopter performance",async()=>{
  const net=network(ini.replace("[FlightDeck]","[FlightDeck]\nBackwardsTaxiVelocity=-4\nSlowTaxiVelocity=3\nForwardsTaxiVelocity=12\nLandingSpeeds=240,170,125")
    .replace("[TaxiPath1]","[TaxiPath1]\nIsSlow=True\nIsBackwards=True"));
  assert.deepEqual(net.deck.speeds,{forward:12,backward:4,slow:3,hold:240,circuit:170,approach:125});
  const catalog=new Catalog(), docs=new Map();
  const add=(rel:string,text:string)=>{
    const file={uri:"file:///"+rel,rel,source:"Workspace"},doc=parse(text);
    catalog.add(file,doc);docs.set(file.uri,doc);
  };
  add("aircraft/helo.ini","[General]\nUnitType=Helicopter\n[Physics]\nClimbRate=12\nMaxSpeedAtSeaLevel=75\nEngineWarmUpTime=2\nRotorsSpinUpTime=4");
  add("aircraft/helo2.ini","#!copy aircraft/helo.ini");
  const group=parse("[AirGroup]\nhelo=Squadron1,2\nhelo2=Squadron1,0");
  const read=(paint={})=>carrierAircraft(group,paint,catalog,new Materials(uri=>docs.get(uri)),new AbortController().signal);
  net.deck.aircraft=await read();
  const [heli]=net.deck.aircraft;
  assert.deepEqual(net.deck.aircraft.map(p=>p.name),["helo"]);
  assert.deepEqual((await read({selected:parse("[Variant1]\nCustomAirGroup=True\nhelo2=Squadron1,1").sections[0]})).map(p=>p.name),["helo2"]);
  assert.equal(heli.warmup,6);
  assert.equal(flightSpeed("departure",net.deck.speeds,heli,[0,0,0],[0,1,0],1,true),12*0.00453571);
  assert.equal(flightSpeed("hold",net.deck.speeds,heli,[0,0,0],[1,0,0],1,true),75*0.0076554087);
  const play=new DeckPlayback(net,"object:launchpoint1");
  play.tick(0);play.tick(1);
  assert.ok(Math.abs(Math.hypot(...play.flights[0].position)-4*0.0076554087)<1e-8);
});

test("launches share a taxi point once the first aircraft clears the lift",()=>{
  const route=ini.replace("NumberOfRecoveryPoints=2","NumberOfRecoveryPoints=0")
    .replace("NumberOfTaxiPaths=2","NumberOfTaxiPoints=1\nNumberOfTaxiPaths=3")
    .replace("AssociatedLaunchPoints=1","AssociatedLaunchPoints=1,2\nRidePosition=1,0,0")
    .replace("Position=1,0,1","Position=5,0,2")
    .replace("From=Elevator1\nTo=LaunchPoint1","From=Elevator1\nTo=TaxiPoint1")
    .replace("From=RecoveryPoint1\nTo=Elevator1","From=TaxiPoint1\nTo=LaunchPoint1")+
    "\n[TaxiPoint1]\nPosition=4,0,1\n[TaxiPath3]\nFrom=TaxiPoint1\nTo=LaunchPoint2";
  for (const [craft,extra,clearance] of [["Helicopter","",0.44642812],["Plane","",1.5*20*0.0148809375],
    ["Helicopter","\nAllowQueue=True\nQueueClearance=1",1]] as const) {
    const net=network(route.replaceAll("AllowedType=Helicopter,VTOL","AllowedType="+craft).replaceAll("AllowedType=Helicopter\n","AllowedType="+craft+"\n")
      .replace("[TaxiPath1]","[TaxiPath1]"+extra));
    if (craft==="Plane") net.deck.aircraft=[airGroupPerformance("test",parse("[General]\nUnitType=Aircraft\n[Performance]\nWingSpan=20"))];
    const play=new DeckPlayback(net);
    play.tick(0);
    const first=play.flights[0];
    let separation=0;
    for (let i=0;i<4000 && play.flights.length<2;i++) {
      play.tick(0.05);
      assert.equal(play.flights.filter(f=>f.platform).length,1);
      separation=Math.hypot(first.position[0]-1,first.position[1],first.position[2]);
      if (first.leg>=first.trip.taxiStart && separation<clearance) assert.ok(first.liftHeld);
    }
    assert.equal(play.flights.length,2);
    assert.ok(!first.liftHeld && first.stationHeld);
    assert.ok(separation>=clearance && separation<clearance+0.01);
    assert.equal(first.trip.phases[first.leg],"forward");
    assert.equal(play.flights[1].trip.lift,first.trip.lift);
  }
});

test("holding aircraft defer reservations and release the recovery point before the ride to the hangar",()=>{
  const net=network(ini.replace("NumberOfLaunchPoints=2","NumberOfLaunchPoints=0")
    .replace("NumberOfTaxiPaths=2","HoldWaypoints=0,40,0|0.01,40,0\nNumberOfTaxiPaths=2")
    .replace("[RecoveryPoint2]","[RecoveryPoint2]\nAssociatedElevators=1\nBlocksElevators=1")
    .replace("From=Elevator1\nTo=LaunchPoint1","From=RecoveryPoint2\nTo=Elevator1")
    .replace("From=RecoveryPoint1\nTo=Elevator1","From=RecoveryPoint1\nWaypoints=1,0,0\nTo=Elevator1"));
  const play=new DeckPlayback(net);
  play.tick(0);
  const [a,b]=play.flights;
  assert.ok(a.holding && b.holding && !a.liftHeld && !b.stationHeld);
  assert.ok(b.position[1]>a.position[1]);
  let cleared=false,waited=false;
  for (let i=0;i<3000 && play.flights.includes(a);i++) {
    play.tick(0.05);
    if (a.liftHeld && b.holding) {waited=true;assert.ok(!b.liftHeld);}
    if (!a.stationHeld && a.liftHeld && a.platform && a.leg>=a.trip.taxiStart) {
      cleared=true;
      assert.ok(a.position[2]<0.01);
    }
  }
  assert.ok(cleared && waited && !play.flights.includes(a));
});

test("selecting a station follows all valid branches to the hangar, and an elevator shows both directions",()=>{
  const text=ini.replace("NumberOfTaxiPaths=2","NumberOfTaxiPaths=7\nNumberOfTaxiPoints=2")
    .replace("AssociatedLaunchPoints=1","AssociatedLaunchPoints=1,2").replace("SpawnPosition=0,0,0","SpawnPosition=0,0,0\nRidePosition=1,0,0")
    .replace("Position=2,0,1","Position=2,0,1\nAssociatedElevators=1")
    .replace("From=RecoveryPoint1\nTo=Elevator1","From=RecoveryPoint1\nTo=TaxiPoint1")+
    "\n[TaxiPoint1]\nPosition=2,0,2\n[TaxiPoint2]\nPosition=3,0,2"+
    "\n[TaxiPath3]\nFrom=TaxiPoint1\nTo=Elevator1\n[TaxiPath4]\nFrom=RecoveryPoint2\nTo=TaxiPoint1"+
    "\n[TaxiPath5]\nFrom=Elevator1\nTo=LaunchPoint2\n[TaxiPath6]\nFrom=RecoveryPoint1\nTo=TaxiPoint2\n[TaxiPath7]\nFrom=TaxiPoint2\nTo=Elevator1";
  const net=network(text),related=(s:string)=>[...net.related("object:"+s)].map(id=>id.slice(7));
  const recovery=related("recoverypoint1");
  for (const row of ["taxipath2","taxipoint1","taxipath3","taxipoint2","taxipath6","taxipath7","elevator1","elevator1/taxi-to-despawn","elevator1/spawn-to-platform"]) assert.ok(recovery.includes(row),row);
  for (const row of ["recoverypoint2","taxipath4","launchpoint2","taxipath5"]) assert.ok(!recovery.includes(row),row);
  const taxi=related("taxipoint2");
  assert.ok(taxi.includes("recoverypoint1") && taxi.includes("taxipath7") && !taxi.includes("taxipath4"));
  for (const selection of ["elevator1","taxipath3","elevator1/spawn-to-platform"]) {
    const connected=related(selection);
    for (const row of ["launchpoint1","launchpoint2","recoverypoint1","recoverypoint2","taxipath4","taxipath5","taxipath6","taxipath7"])
      assert.ok(connected.includes(row),selection+" to "+row);
    assert.ok(!connected.includes(selection));
  }
});
