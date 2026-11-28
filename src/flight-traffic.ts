import { field, point, type EntityScene, type EntityObject, type EntityPart, type Vector } from "./entity-model";
import type { IniSection, parse } from "./ini";
import { elevatorRidePath, elevatorRider, timedElevatorClip, type ElevatorMotion } from "./elevator-motion";

import { aircraftPerformance, deckSpeeds, flightSpeed, type AircraftPerformance, type Craft, type DeckSpeeds, type FlightPhase } from "./flight-speeds";

const craftOrder=["vtol","helicopter","plane","stol"] as const;
type Operation="launch"|"recovery";
const id=(name:string)=>"object:"+name;
const distance=(a:Vector,b:Vector)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const get=(s:IniSection,k:string)=>field(s,k)?.value;
const list=(s:IniSection,k:string)=>(get(s,k) ?? "").toLowerCase().split(",").map(t=>t.trim());
function number(s:IniSection,k:string,fallback:number) {
  const n=Number(get(s,k) ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}
interface Spot {
  name:string; role:string; position?:Vector; types:Craft[]; elevators:string[]; launches:string[];
  blocks:string[]; free:string[]; interval:number; heading:number; vtolHeading:number; ascend:number;
  roll:number; ride?:Vector[]; heliRide?:Vector[];
  single:boolean; startsLowered:boolean; closeAfterTaxi:boolean; requiresFree:boolean; ridePosition?:Vector; exit?:Vector;
}
export interface FlightDeckLayout {
  holdSeparation:number; heliSeparation:number; speeds:DeckSpeeds; aircraft:AircraftPerformance[];
  spots:Spot[]; landingWhileLaunching:boolean; launchDelay:number; spawnInterval:number;
  departures:Partial<Record<Craft,Vector>>;
}
export function flightDeckLayout(doc:ReturnType<typeof parse>,scene:EntityScene):FlightDeckLayout|undefined {
  const deck=doc.sections.find(s=>/^flightdeck$/i.test(s.name));
  if (!deck) return;
  const names=["launchpoint","recoverypoint","taxipoint","elevator"];
  const spots:Spot[]=[];
  const parts=new Map(scene.parts.map(p=>[p.id,p]));
  for (const s of doc.sections) {
    const name=s.name.toLowerCase(), match=/^(launchpoint|recoverypoint|taxipoint|elevator)([1-9]\d*)$/.exec(name);
    if (!match || Number(match[2])>number(deck,"numberof"+match[1]+"s",0)) continue;
    const role=match[1];
    if (role==="elevator" && /^true$/i.test(get(s,"unused"))) continue;
    const links=(k:string,prefix:string)=>list(s,k).filter(n=>/^[1-9]\d*$/.test(n)).map(n=>prefix+n);
    const heading=number(s,"rotation",0);
    const spot:Spot={name,role,requiresFree:/^true$/i.test(get(s,"requiresfreelaunchpoint")),closeAfterTaxi:/^true$/i.test(get(s,"closedoorsaftertaxi")),
      exit:point(get(s,"exitposition")),position:point(get(s,role==="elevator" ? "spawnposition" : "position")),
      types:craftOrder.filter(t=>list(s,"allowedtype").includes(t)),
      elevators:links("associatedelevators","elevator"),launches:links("associatedlaunchpoints","launchpoint"),
      blocks:names.flatMap(p=>links("blocks"+p+"s",p)),free:links("takeoffrequiresfreelaunchpoints","launchpoint"),
      interval:number(s,"landinginterval",90),heading,vtolHeading:number(s,"vtol_rotation",heading),
      ascend:number(s,"vtol_ascend",0.22321406),roll:number(s,"mintakeofflength",7),startsLowered:/^true$/i.test(get(s,"startslowered")),single:/^true$/i.test(get(s,"singlevehicle"))};
    if (role==="elevator") {
      if ((get(s,"associatedlaunchpoints") ?? "").includes("-1")) spot.launches=[];
      const lift=scene.elevators?.find(l=>l.name.toLowerCase()===name), part=parts.get(lift?.part);
      const ride=spot.ridePosition=point(get(s,"rideposition")) ?? spot.position;
      function rise(board:Vector) {
        return board && spot.position && [spot.position,...(part && elevatorRidePath(board,part,parts,lift.raise,"path") || [board])];
      }
      spot.ride=rise(ride);
      spot.heliRide=rise(point(get(s,"helicopterrideposition")) ?? ride);
    }
    spots.push(spot);
  }
  const launches=spots.filter(s=>s.role==="launchpoint").sort((a,b)=>Number(a.name.slice(11))-Number(b.name.slice(11)));
  const departures:FlightDeckLayout["departures"]={};
  for (const craft of craftOrder) {
    const p=point(get(deck,(craft==="stol" ? "plane" : craft)+"initialwaypoint"));
    if (p?.some(Boolean)) departures[craft]=[p[0]*27.559496,p[1]*0.00453571,p[2]*27.559496];
  }
  const resolveLaunch=(n:string)=>launches[Number(n.slice(11))-1]?.name;
  for (const spot of spots) {
    spot.launches=spot.launches.map(resolveLaunch).filter(Boolean);
    spot.free=spot.free.map(resolveLaunch).filter(Boolean);
  }
  return {spots,departures,holdSeparation:number(deck,"holdstackseparation",500)*0.00453571,heliSeparation:number(deck,"helicopterholdstackseparation",-1)*0.00453571,
    speeds:deckSpeeds(deck),aircraft:[],launchDelay:number(deck,"launchdelay",0),spawnInterval:Math.max(0.1,number(deck,"spawninterval",0.1)),
    landingWhileLaunching:!/^false$/i.test(get(deck,"landingwhilelaunching"))};
}

type Route=EntityObject & {route:NonNullable<EntityObject["route"]>};
interface LiftRide {
  leg:number; motion:ElevatorMotion; duration:number; returnDuration:number; sample:(time:number)=>Vector;
}
interface Trip {
  phases:FlightPhase[]; finalApproachStarts:number; ride?:LiftRide;
  craft:Craft; operation:Operation; station:Spot; lift?:Spot; legs:Vector[][];
  taxiStart:number; clearLeg:number; clearSegment:number; queueClearance:number;
}
const rolls=(s:Spot,craft:Craft)=>craft==="plane" || (craft!=="helicopter" && s.types.includes("plane"));
export class FlightNetwork {
  readonly links=new Map<string,Set<string>>();
  private readonly spots:Map<string,Spot>;
  private readonly routes:Route[];
  private readonly relatedCache=new Map<string,Set<string>>();
  private readonly parts:Map<string,EntityPart>;
  constructor(readonly deck:FlightDeckLayout,objects:EntityObject[],private readonly rig?:Pick<EntityScene,"elevators"|"parts">) {
    this.parts=new Map(rig?.parts.map(p=>[p.id,p]));
    this.spots=new Map(deck.spots.map(s=>[s.name,s]));
    this.routes=objects.filter((o):o is Route=>!!o.route);
    const connect=(a:string,b:string)=>{
      if (a===b) return;
      for (const [x,y] of [[a,b],[b,a]]) {
        if (!this.links.has(x)) this.links.set(x,new Set());
        this.links.get(x).add(y);
      }
    };
    const incident=new Map<string,string[]>();
    for (const r of this.routes) {
      if (r.route.elevator) connect(r.id,id(r.route.elevator));
      for (const n of [r.route.from,r.route.to]) if (this.spots.has(n)) {
        connect(r.id,id(n));
        if (!incident.has(n)) incident.set(n,[]);
        incident.get(n).push(r.id);
      }
      if (this.spots.has(r.route.from) && this.spots.has(r.route.to)) connect(id(r.route.from),id(r.route.to));
      if (r.route.kind==="airPaths" && r.route.to) for (const h of this.holds()) {
        if (r.route.types.some(t=>this.holdFor(t)===h || (h.name.includes("LargeHold") && t==="plane"))) connect(r.id,h.id);
      }
    }
    for (const ids of incident.values()) for (let i=0;i<ids.length;i++)
      for (let j=i+1;j<ids.length;j++) connect(ids[i],ids[j]);
    for (const s of deck.spots) for (const n of [...s.elevators,...s.launches])
      if (this.spots.has(n)) connect(id(s.name),id(n));
  }
  private holds() { return this.routes.filter(r=>r.route.kind==="airPaths" && !r.route.to); }
  private holdFor(craft:string) {
    const holds=this.holds();
    return (craft==="helicopter" && holds.find(h=>h.id.endsWith("/helicopterholdwaypoints"))) || holds.find(h=>h.id.endsWith("/holdwaypoints"));
  }
  // Find a directed taxi route, optionally through the selected branch of the network.
  private taxi(from:string,to:string,station:string,craft:Craft,via?:string) {
    const queue=[{at:from,path:[] as Route[],matched:!via || id(from)===via}], visited=new Set<string>();
    for (let i=0;i<queue.length;i++) {
      const {at,path,matched}=queue[i], key=at+"/"+matched;
      if (visited.has(key)) continue;
      visited.add(key);
      if (at===to && matched) return path;
      if (at!==from && this.spots.get(at)?.role!=="taxipoint") continue;
      for (const edge of this.routes) {
        const r=edge.route;
        if (r.from!==at || !this.spots.has(r.to) || (r.arrivals && !r.arrivals.includes(station+"/"+craft))) continue;
        queue.push({at:r.to,path:[...path,edge],matched:matched || via===edge.id || via===id(r.to)});
      }
    }
  }
  private addRide(legs:Vector[][], index:number, range:{start:number;end:number}, name:string, motion:ElevatorMotion):LiftRide|undefined {
    const elevator=this.rig?.elevators?.find(e=>e.name.toLowerCase()===name);
    const part=this.parts.get(elevator?.part);
    if (!range || !part || !timedElevatorClip(elevator[motion])) return;
    const points=legs[index], {start,end}=range;
    const clip=elevator[motion], sample=elevatorRider(points[start],part,this.parts,clip);
    if (!sample) return;
    const back=elevator[motion==="raise" ? "lower" : "raise"];
    legs.splice(index,1,points.slice(0,start+1),points.slice(start,end+1),points.slice(end));
    return {leg:index+1,motion,duration:clip.at(-1).time,returnDuration:timedElevatorClip(back) ? back.at(-1).time : 0,sample};
  }
  private taxiBranches(edges:Route[],from:string,to:string) {
    const transit=(at:string)=>this.spots.get(at)?.role==="taxipoint";
    const reach=(first:string,last:string,reverse:boolean)=>{
      const seen=new Set([first]);
      for (const at of seen) {
        if (at===last || (at!==first && !transit(at))) continue;
        for (const {route:r} of edges) if ((reverse ? r.to : r.from)===at) seen.add(reverse ? r.from : r.to);
      }
      return seen;
    };
    const forward=reach(from,to,false), backward=reach(to,from,true);
    return edges.filter(({route:r})=>forward.has(r.from) && backward.has(r.to) &&
      r.from!==to && r.to!==from && (r.from===from || transit(r.from)) && (r.to===to || transit(r.to)));
  }
  related(focus:string) {
    if (!focus) return;
    if (this.relatedCache.has(focus)) return this.relatedCache.get(focus);
    const route=this.routes.find(r=>r.id===focus)?.route;
    const lift=[route?.elevator,route?.from,route?.to].find(n=>this.spots.get(n)?.role==="elevator");
    const anchor=lift ? id(lift) : focus;
    const selectedEdge=anchor===focus && route?.from && route?.to ? route : undefined;
    const related=new Set<string>();
    for (const trip of this.trips(anchor)) {
      const {station,craft,operation}=trip, launch=operation==="launch";
      related.add(id(station.name));
      if (!launch) for (const r of this.routes) {
        if (r.route.kind==="airPaths" && r.route.to===station.name && r.route.types.includes(craft)) related.add(r.id);
      }
      if (!launch && this.holdFor(craft)) related.add(this.holdFor(craft).id);
      if (!trip.lift) continue;
      const elevator=trip.lift.name;
      related.add(id(elevator));
      const arrival=station.name+"/"+craft;
      const edges=this.routes.filter(r=>r.route.from && r.route.to && (!r.route.arrivals || r.route.arrivals.includes(arrival)));
      const start=launch ? elevator : station.name,end=launch ? station.name : elevator;
      const taxiPoint=focus.startsWith("object:") && this.spots.get(focus.slice(7))?.role==="taxipoint" ? focus.slice(7) : undefined;
      const corridors=selectedEdge ? [[start,selectedEdge.from],[selectedEdge.to,end]] : taxiPoint ? [[start,taxiPoint],[taxiPoint,end]] : [[start,end]];
      for (const [from,to] of corridors) {
        if (from===to) continue;
        for (const edge of this.taxiBranches(edges,from,to)) {
          related.add(edge.id);
          related.add(id(edge.route.from));
          related.add(id(edge.route.to));
        }
      }
      for (const {id:row,route:r} of this.routes) {
        if (r.elevator!==elevator) continue;
        // Spawn and boarding rows show the hangar end of this same elevator.
        if (lift || (r.types.includes(craft) && (r.operation==="launch" || (!launch && r.arrivals?.includes(arrival))))) related.add(row);
      }
    }
    if (!related.size) for (const key of this.links.get(anchor) ?? []) related.add(key);
    related.delete(focus);
    this.relatedCache.set(focus,related);
    return related;
  }
  trips(focus?:string) {
    const segment=this.routes.find(r=>r.id===focus && r.route.elevator);
    if (segment) focus=id(segment.route.elevator);
    const trips:Trip[]=[];
    const lifts=this.deck.spots.filter(s=>s.role==="elevator");
    for (const station of this.deck.spots) {
      if (!station.position || !["launchpoint","recoverypoint"].includes(station.role)) continue;
      const launch=station.role==="launchpoint", operation=launch ? "launch" : "recovery";
      for (const craft of station.types) {
        const focused=this.routes.find(r=>r.id===focus);
        const approachRoutes=this.routes.filter(r=>r.route.kind==="airPaths" && r.route.to===station.name && r.route.types.includes(craft));
        const approach=approachRoutes.find(r=>r===focused) ?? approachRoutes[0];
        const normalHold=this.holdFor(craft);
        const largeHold=focused?.id.endsWith("/largeholdwaypoints") && craft==="plane";
        const hold=largeHold ? focused : normalHold;
        const airborne=launch ? undefined : [hold,approach].filter(Boolean);
        const links=new Set([id(station.name),...(airborne ?? []).map(r=>r.id)]);
        if (focus && focused?.route.kind==="airPaths" && !links.has(focus)) continue;
        const via=focus && !links.has(focus) ? focus : undefined;
        const eligible=lifts.filter(e=>launch ? e.launches.includes(station.name) : station.elevators.includes(e.name));
        for (const lift of eligible.length ? eligible : [undefined]) {
          const taxi=lift ? this.taxi(launch ? lift.name : station.name,launch ? station.name : lift.name,station.name,craft,via) : [];
          if (!taxi || (!lift && (via || lifts.length))) continue;
          const legs=taxi.map(r=>r.route.points);
          const phases:FlightPhase[]=taxi.map(r=>r.route.taxiSpeed ?? "forward");
          let liftRide:LiftRide;
          let finalApproachStarts=0,taxiStart=0,clearLeg=0,clearSegment=0;
          const queueClearance=Math.max(-1,...taxi.map(r=>r.route.queueClearance ?? -1));
          if (launch) {
            const ride=craft==="helicopter" ? lift?.heliRide : lift?.ride;
            if (ride) {
              legs.unshift(ride);
              phases.unshift("slow");
              liftRide=this.addRide(legs,0,{start:1,end:ride.length-1},lift.name,"raise");
            }
            taxiStart=legs.length-taxi.length;
            legs.push(this.departure(station,craft));
            phases.push("departure");
          } else {
            if (!approach) continue;
            const entry=approach.route.points[0];
            legs.unshift(...(hold ? [hold.route.points,[hold.route.points.at(-1),entry]] : []),approach.route.points);
            if (hold) phases.unshift("hold","circuit","approach");
            else phases.unshift("approach");
            finalApproachStarts=Math.max(0,approach.route.points.length-(craft==="helicopter" || !rolls(station,craft) ? 2 : 5));
            taxiStart=legs.length-taxi.length;
            clearLeg=legs.length-1;
            const last=taxi.at(-1)?.route;
            let board=last?.taxiEnd ?? 0,range=last?.ride;
            if (taxi.length && station.exit?.some(Boolean) && distance(station.position,station.exit)>0.14880937) {
              const first=legs[taxiStart];
              legs[taxiStart]=[first[0],station.exit,...first.slice(1)];
              if (taxi.length===1) {
                board++;
                if (range) range={start:range.start+1,end:range.end+1};
              }
            }
            clearSegment=Math.max(0,board-1);
            if (lift) liftRide=this.addRide(legs,clearLeg,range,lift.name,"lower");
          }
          if (liftRide) {
            const i=liftRide.leg-1;
            phases.splice(i,1,phases[i],"slow","slow");
          }
          trips.push({station,craft,operation,lift,legs,phases,finalApproachStarts,ride:liftRide,taxiStart,clearLeg,clearSegment,queueClearance});
        }
      }
    }
    return trips;
  }
  private departure(s:Spot,craft:Craft):Vector[] {
    const rolling=rolls(s,craft);
    const verticalJet=!rolling && craft!=="helicopter";
    const [x,y,z]=s.position, heading=(verticalJet ? s.vtolHeading : s.heading)*Math.PI/180;
    const along=(d:number,h:number):Vector=>[x+Math.sin(heading)*d,y+h,z+Math.cos(heading)*d];
    const length=Math.max(0,s.roll), height=Math.max(0,s.ascend);
    const leg:Vector[]=rolling ? [s.position,along(length,0),along(length+0.6,0.25)] :
      [s.position,along(0,verticalJet ? height : 0.15)];
    leg.push(this.deck.departures[craft] ?? along(rolling ? length+1 : 0.6,rolling ? 0.5 : Math.max(height,0.3)));
    return leg;
  }
}

interface Flight {
  stationHeld:boolean; liftHeld:boolean; holding:boolean; platform:boolean; departed:boolean; restoreTime?:number;
  trip:Trip; aircraft:AircraftPerformance; start:number; warmup:number; leg:number; segment:number; distance:number;
  position:Vector; rideTime:number; returnTime?:number;
}
export class DeckPlayback {
  readonly flights:Flight[]=[];
  readonly elevators=new Map<string,{motion:ElevatorMotion;time:number}>();
  private readonly stations:Trip[][];
  private readonly next=new Map<string,number>();
  private readonly available=new Map<string,number>();
  private readonly launchedFrom=new Set<string>();
  private readonly served=new Set<string>();
  private cursor=0;
  private preferred:Operation="launch";
  private time=0;
  constructor(readonly network:FlightNetwork,readonly focus?:string) {
    const grouped=new Map<string,Trip[]>();
    for (const t of network.trips(focus)) {
      const k=t.station.name;
      if (!grouped.has(k)) grouped.set(k,[]);
      grouped.get(k).push(t);
    }
    this.stations=[...grouped.values()];
    for (const trips of this.stations) for (const {lift,ride} of trips) {
      if (!ride || this.elevators.has(lift.name)) continue;
      const atEnd=lift.startsLowered===(ride.motion==="lower");
      if (atEnd || !ride.returnDuration)
        this.elevators.set(lift.name,{motion:ride.motion,time:atEnd ? ride.duration : 0});
      else this.elevators.set(lift.name,{motion:ride.motion==="raise" ? "lower" : "raise",time:ride.returnDuration});
    }
  }
  get playable() {return !!this.stations.length;}
  private busy(point:Spot,owner?:Flight,allowSame=false) {
    if (!point) return false;
    const conflicts=(held:Spot)=>held.name===point.name ? !allowSame || point.blocks.includes(point.name) :
      point.blocks.includes(held.name) || held.blocks.includes(point.name);
    if (this.network.deck.spots.some(lift=>!(owner?.liftHeld && lift===owner.trip.lift) && lift.role==="elevator" && conflicts(lift) && this.awayFromHome(lift))) return true;
    return this.flights.some(f=>f!==owner && ((f.stationHeld && conflicts(f.trip.station)) || (f.liftHeld && conflicts(f.trip.lift))));
  }
  private awayFromHome(lift:Spot) {
    const pose=this.elevators.get(lift.name);
    if (!pose) return false;
    const movingHome=pose.motion===(lift.startsLowered ? "lower" : "raise");
    // A moving platform has an owner. An idle pose is at one end of its clip.
    return movingHome ? pose.time===0 : pose.time>0;
  }
  private canRecover(t:Trip,owner?:Flight) {
    return this.time>=(this.available.get(t.station.name) ?? 0) && !this.busy(t.station,owner,true) &&
      (!t.lift || ((!t.lift.single || this.focus || this.launchedFrom.has(t.lift.name)) &&
        !this.flights.some(f=>f!==owner && f.liftHeld && f.trip.lift===t.lift && f.trip.operation==="launch")));
  }
  private board(f:Flight) {
    const {lift,ride}=f.trip;
    if (!lift || f.platform) return true;
    if (this.flights.some(other=>other!==f && other.platform && other.trip.lift===lift)) return false;
    f.platform=true;
    if (ride) {
      const last=this.elevators.get(lift.name);
      if (last?.motion===ride.motion && last.time===ride.duration && ride.returnDuration) {
        f.returnTime=0;
        this.elevators.set(lift.name,{motion:ride.motion==="raise" ? "lower" : "raise",time:0});
      } else this.elevators.set(lift.name,{motion:ride.motion,time:0});
    }
    return true;
  }
  private releaseLift(f:Flight) {
    f.liftHeld=false;
    f.platform=false;
  }
  private restoreLift(f:Flight,elapsed:number) {
    const {ride,lift}=f.trip;
    if (ride.returnDuration) {
      f.restoreTime=Math.min(ride.returnDuration,(f.restoreTime ?? 0)+elapsed);
      this.elevators.set(lift.name,{motion:ride.motion==="lower" ? "raise" : "lower",time:f.restoreTime});
      if (f.restoreTime<ride.returnDuration) return false;
    }
    this.releaseLift(f);
    return true;
  }
  private admit(f:Flight) {
    f.holding=false;
    f.stationHeld=true;
    f.liftHeld=!!f.trip.lift;
    this.available.set(f.trip.station.name,this.time+f.trip.station.interval);
  }
  private stackHold(trip:Trip,owner?:Flight) {
    const {holdSeparation,heliSeparation}=this.network.deck;
    const heli=trip.craft==="helicopter";
    const queue=owner ? this.flights.slice(0,this.flights.indexOf(owner)) : this.flights;
    const ahead=queue.filter(f=>f.holding && (heliSeparation<0 || (f.trip.craft==="helicopter")===heli)).length;
    const offset=ahead*(heli && heliSeparation>=0 ? heliSeparation : holdSeparation);
    if (!offset && !owner) return trip;
    const legs=trip.legs.slice();
    legs[0]=legs[0].map(([x,y,z])=>[x,y+offset,z]);
    if (owner && legs[0].length>1) legs[0][0]=owner.position;
    legs[1]=[legs[0].at(-1),...legs[1].slice(1)];
    return {...trip,legs};
  }
  private advanceHold(f:Flight) {
    const {trip}=f, leg=trip.legs[0];
    if (f.segment<leg.length-2) return true;
    const options=this.stations.find(s=>s[0].station===trip.station).filter(t=>t.craft===trip.craft);
    const base=options[0], ceiling=Math.max(...base.legs[0].map(p=>p[1]))+3;
    if (this.flights.find(other=>other.holding)===f && f.position[1]<=ceiling) {
      const incoming=(t:Trip)=>this.flights.filter(other=>other.liftHeld && other.trip.lift===t.lift).length;
      const next=options.filter(t=>this.canRecover(t,f)).sort((a,b)=>incoming(a)-incoming(b))[0];
      if (next) {
        f.trip={...next,legs:[...trip.legs.slice(0,2),...next.legs.slice(2)]};
        this.admit(f);
        return true;
      }
    }
    if (f.segment+1<leg.length) return true;
    f.trip=this.stackHold(base,f);
    f.segment=0;
    f.distance=0;
    if (leg.length===1) f.position=f.trip.legs[0][0];
    return false;
  }
  // Return the time left to move after acquiring the required deck resources.
  private taxiReservations(f:Flight,elapsed:number) {
    const {trip}=f, {lift,ride}=trip;
    if (trip.operation==="recovery") {
      if (!lift || f.leg<trip.clearLeg || (f.leg===trip.clearLeg && f.segment<trip.clearSegment)) return elapsed;
      f.stationHeld=false;
      return this.board(f) ? elapsed : undefined;
    }
    if (f.leg<trip.taxiStart || f.departed) return elapsed;
    if (!f.stationHeld) {
      if (this.busy(trip.station,f,trip.queueClearance>=0)) return;
      f.stationHeld=true;
    }
    if (!f.liftHeld) return elapsed;
    const atLaunch=trip.phases[f.leg]==="departure";
    const clearance=Math.max(f.aircraft.elevatorClearance,trip.queueClearance);
    if (!atLaunch && (!lift.ridePosition || distance(f.position,lift.ridePosition)<clearance)) return elapsed;
    if (ride && lift.startsLowered && lift.closeAfterTaxi) {
      if (!atLaunch) return elapsed;
      const left=ride.returnDuration-(f.restoreTime ?? 0);
      return this.restoreLift(f,elapsed) ? Math.max(0,elapsed-left) : undefined;
    }
    this.releaseLift(f);
    return elapsed;
  }
  private waitingForTraffic(f:Flight,b:Vector) {
    // GroundTaxiPhysics enables its forward 45-degree spacing check on queued vessel routes.
    const [x,y,z]=f.position,dx=b[0]-x,dz=b[2]-z;
    return this.flights.some(other=>{
      if (other===f || other.holding || other.departed || other.leg>=other.trip.legs.length ||
        (other.trip.operation==="recovery" && other.leg<other.trip.taxiStart)) return false;
      const p=other.position,ox=p[0]-x,oz=p[2]-z;
      return Math.hypot(ox,p[1]-y,oz)<=Math.max(f.aircraft.taxiSpacing,other.aircraft.taxiSpacing) &&
        dx*ox+dz*oz>Math.SQRT1_2*Math.hypot(dx,dz)*Math.hypot(ox,oz);
    });
  }
  private start(operation:Operation) {
    if (!this.network.deck.landingWhileLaunching && this.flights.length && this.flights[0].trip.operation!==operation) return false;
    for (let n=0;n<this.stations.length;n++) {
      const i=(this.cursor+n)%this.stations.length, station=this.stations[i], s=station[0].station;
      if (this.served.has(s.name) || station[0].operation!==operation) continue;
      if (operation==="launch" && this.time<(this.available.get("launch") ?? 0)) continue;
      const types=craftOrder.filter(t=>station.some(p=>p.craft===t)), turn=this.next.get(s.name) ?? 0;
      const candidates=station.filter(t=>t.craft===types[turn%types.length] &&
        !(operation==="launch" && !this.focus && t.lift?.single && this.launchedFrom.has(t.lift.name)));
      const launch=operation==="launch";
      let trip=candidates.find(t=>launch ? !this.busy(t.lift) && ((t.lift && !t.lift.requiresFree) || !this.busy(s)) :
        t.phases[0]==="hold" || this.canRecover(t));
      if (!trip) continue;
      const holding=!launch && trip.phases[0]==="hold";
      if (holding) trip=this.stackHold(trip);
      const profiles=this.network.deck.aircraft.filter(p=>p.craft===trip.craft);
      const aircraft=profiles.length ? profiles[Math.floor(turn/types.length)%profiles.length] : aircraftPerformance(trip.craft);
      const f:Flight={trip,aircraft,start:this.time,warmup:aircraft.warmup,leg:0,segment:0,distance:0,position:trip.legs[0][0],rideTime:0,
        holding,stationHeld:false,liftHeld:launch && !!trip.lift,platform:false,departed:false};
      this.flights.push(f);
      if (launch) {
        this.board(f);
        if (!trip.lift) f.stationHeld=true;
      } else if (!holding) this.admit(f);
      this.next.set(s.name,turn+1);
      if (!this.focus) this.served.add(s.name);
      if (launch && trip.lift?.single) this.launchedFrom.add(trip.lift.name);
      if (launch) this.available.set("launch",this.time+this.network.deck.spawnInterval);
      this.cursor=(i+1)%this.stations.length;
      this.preferred=operation==="launch" ? "recovery" : "launch";
      return true;
    }
    return false;
  }
  tick(dt:number) {
    this.time+=dt;
    for (let i=this.flights.length-1;i>=0;i--) {
      const f=this.flights[i];
      let elapsed=dt;
      while (f.leg<f.trip.legs.length) {
        if (f.holding && !this.advanceHold(f)) break;
        const {trip}=f, launch=trip.operation==="launch";
        const {ride,lift}=trip,leg=trip.legs[f.leg],phase=trip.phases[f.leg];
        const taxiTime=this.taxiReservations(f,elapsed);
        if (taxiTime===undefined) break;
        elapsed=taxiTime;
        if (f.returnTime!==undefined) {
          const step=Math.min(elapsed,ride.returnDuration-f.returnTime);
          f.returnTime+=step;
          elapsed-=step;
          this.elevators.get(lift.name).time=f.returnTime;
          if (f.returnTime<ride.returnDuration) break;
          f.returnTime=undefined;
          this.elevators.set(lift.name,{motion:ride.motion,time:0});
        }
        if (ride && f.leg===ride.leg) {
          const step=Math.min(elapsed,ride.duration-f.rideTime);
          f.rideTime+=step;
          elapsed-=step;
          this.elevators.get(lift.name).time=f.rideTime;
          f.position=ride.sample(f.rideTime);
          if (f.rideTime<ride.duration) break;
          f.leg++;
          continue;
        }
        if (f.segment+1>=leg.length) {f.leg++;f.segment=0;f.distance=0;continue;}
        const a=leg[f.segment],b=leg[f.segment+1],len=distance(a,b);
        if (launch && trip.queueClearance>=0 && f.leg>=trip.taxiStart && phase!=="departure" && len && this.waitingForTraffic(f,b)) break;
        let speedPhase=phase;
        if (phase==="departure" && f.warmup>0) {
          if (f.aircraft.craft==="plane" || f.aircraft.craft==="stol")
            f.warmup=Math.max(0,f.aircraft.warmup-(this.time-elapsed-f.start));
          const step=Math.min(elapsed,f.warmup);
          f.warmup-=step;
          elapsed-=step;
          if (f.warmup>0) break;
        }
        if (phase==="approach") {
          if (f.segment+1<f.trip.finalApproachStarts) speedPhase="circuit";
          else if (f.segment===leg.length-2) speedPhase="touchdown";
        }
        if (phase==="departure" && !f.departed) {
          if (this.time<(this.available.get("takeoff") ?? 0) ||
            (rolls(trip.station,trip.craft) && this.flights.some(other=>other!==f && other.stationHeld && trip.station.free.includes(other.trip.station.name)))) break;
          this.available.set("takeoff",this.time+this.network.deck.launchDelay);
          f.departed=true;
        }
        if (f.departed && (trip.craft==="helicopter" || f.segment===leg.length-2)) f.stationHeld=false;
        const speed=flightSpeed(speedPhase,this.network.deck.speeds,f.aircraft,a,b,len-f.distance,!rolls(f.trip.station,f.trip.craft));
        const left=(len-f.distance)/speed;
        if (elapsed<left) {
          f.distance+=elapsed*speed;
          f.position=a.map((v,j)=>v+(b[j]-v)*f.distance/len) as Vector;
          break;
        }
        elapsed-=left;f.position=b;f.segment++;f.distance=0;
      }
      if (f.leg===f.trip.legs.length) {
        const {ride,lift}=f.trip;
        if (ride && f.platform && !lift.startsLowered && f.trip.operation==="recovery" && !this.restoreLift(f,elapsed)) continue;
        if (f.trip.operation==="recovery" && f.trip.lift?.single) this.launchedFrom.delete(f.trip.lift.name);
        this.flights.splice(i,1);
      }
    }
    // Give slower, heavily interlocked stations a turn before refilling the same fast route.
    if (!this.flights.length && this.stations.every(group=>this.served.has(group[0].station.name) ||
      group.every(t=>t.operation==="launch" && !this.focus && t.lift?.single && this.launchedFrom.has(t.lift.name)))) {
      this.served.clear();
    }
    while (!this.focus || !this.flights.length) {
      if (!this.start(this.preferred) && !this.start(this.preferred==="launch" ? "recovery" : "launch")) break;
    }
  }
}
