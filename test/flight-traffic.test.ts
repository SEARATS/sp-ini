import test from "node:test";
import assert from "node:assert/strict";
import { entityObjects, entityParts, expandEntityIni, type EntityScene } from "../src/entity-model";
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
  for(let i=0;i<500;i++){
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
  for(let i=0;i<500;i++) {
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
    for (let i=0;i<700;i++) {
      play.tick(0.1);most=Math.max(most,play.flights.length);
      const points=play.flights.map(f=>f.trip.station.name);
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
