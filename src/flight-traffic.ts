import { field, point, type EntityScene, type EntityObject, type Vector } from "./entity-model";
import type { IniSection, parse } from "./ini";
import { elevatorRidePath } from "./elevator-motion";

const craftOrder=["vtol","helicopter","plane","stol"] as const;
type Craft=typeof craftOrder[number];
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
  single:boolean;
}
export interface FlightDeckLayout {
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
    const spot:Spot={name,role,position:point(get(s,role==="elevator" ? "spawnposition" : "position")),
      types:craftOrder.filter(t=>list(s,"allowedtype").includes(t)),
      elevators:links("associatedelevators","elevator"),launches:links("associatedlaunchpoints","launchpoint"),
      blocks:names.flatMap(p=>links("blocks"+p+"s",p)),free:links("takeoffrequiresfreelaunchpoints","launchpoint"),
      interval:number(s,"landinginterval",90),heading,vtolHeading:number(s,"vtol_rotation",heading),
      ascend:number(s,"vtol_ascend",0.22321406),roll:number(s,"mintakeofflength",7),single:/^true$/i.test(get(s,"singlevehicle"))};
    if (role==="elevator") {
      if ((get(s,"associatedlaunchpoints") ?? "").includes("-1")) spot.launches=[];
      const lift=scene.elevators?.find(l=>l.name.toLowerCase()===name), part=parts.get(lift?.part);
      const ride=point(get(s,"rideposition")) ?? spot.position;
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
  return {spots,departures,launchDelay:number(deck,"launchdelay",0),spawnInterval:number(deck,"spawninterval",0.1),
    landingWhileLaunching:!/^false$/i.test(get(deck,"landingwhilelaunching"))};
}

type Route=EntityObject & {route:NonNullable<EntityObject["route"]>};
interface Trip {
  craft:Craft; operation:Operation; station:Spot; lift?:Spot; legs:Vector[][]; uses:Set<string>; blocks:Set<string>;
}
const rolls=(s:Spot,craft:Craft)=>craft==="plane" || (craft!=="helicopter" && s.types.includes("plane"));
export class FlightNetwork {
  readonly links=new Map<string,Set<string>>();
  private readonly spots:Map<string,Spot>;
  private readonly routes:Route[];
  constructor(readonly deck:FlightDeckLayout,objects:EntityObject[]) {
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
  trips(focus?:string) {
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
          const uses=new Set([station.name]);
          if (lift) uses.add(lift.name);
          for (const edge of taxi) for (const n of [edge.id,edge.route.from,edge.route.to]) uses.add(n);
          const blocks=new Set([...uses].flatMap(n=>this.spots.get(n)?.blocks ?? []));
          if (launch && rolls(station,craft)) station.free.forEach(n=>blocks.add(n));
          const legs=taxi.map(r=>r.route.points);
          if (launch) {
            const ride=craft==="helicopter" ? lift?.heliRide : lift?.ride;
            if (ride) legs.unshift(ride);
            legs.push(this.departure(station,craft));
          } else {
            if (!approach) continue;
            const entry=approach.route.points[0];
            legs.unshift(...(hold ? [hold.route.points,[hold.route.points.at(-1),entry]] : []),approach.route.points);
          }
          trips.push({station,craft,operation,lift,legs,uses,blocks});
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

interface Flight {trip:Trip;leg:number;segment:number;distance:number;position:Vector}
export class DeckPlayback {
  readonly flights:Flight[]=[];
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
  }
  get playable() {return !!this.stations.length;}
  private start(operation:Operation) {
    if (!this.network.deck.landingWhileLaunching && this.flights.length && this.flights[0].trip.operation!==operation) return false;
    for (let n=0;n<this.stations.length;n++) {
      const i=(this.cursor+n)%this.stations.length, station=this.stations[i], s=station[0].station;
      if (this.served.has(s.name) || station[0].operation!==operation || this.time<(this.available.get(s.name) ?? 0)) continue;
      if (operation==="launch" && this.time<(this.available.get("launch") ?? 0)) continue;
      const types=craftOrder.filter(t=>station.some(p=>p.craft===t)), turn=this.next.get(s.name) ?? 0;
      const candidates=station.filter(t=>t.craft===types[turn%types.length] &&
        !(operation==="launch" && !this.focus && t.lift?.single && this.launchedFrom.has(t.lift.name)));
      const trip=candidates.find(t=>this.flights.every(f=>{
        for (const key of t.uses) if (f.trip.uses.has(key) || f.trip.blocks.has(key)) return false;
        for (const key of t.blocks) if (f.trip.uses.has(key)) return false;
        return true;
      }));
      if (!trip) continue;
      this.flights.push({trip,leg:0,segment:0,distance:0,position:trip.legs[0][0]});
      this.next.set(s.name,turn+1);
      if (!this.focus) this.served.add(s.name);
      if (operation==="launch" && trip.lift?.single) this.launchedFrom.add(trip.lift.name);
      // Use an accelerated preview clock for configured intervals.
      if (operation==="launch") this.available.set("launch",this.time+Math.max(this.network.deck.launchDelay,this.network.deck.spawnInterval)/12);
      else this.available.set(s.name,this.time+s.interval/12);
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
        const leg=f.trip.legs[f.leg];
        if (f.segment+1>=leg.length) {f.leg++;f.segment=0;f.distance=0;continue;}
        const a=leg[f.segment],b=leg[f.segment+1],len=distance(a,b);
        // Longer airborne legs use a faster playback speed so the deck work stays visible.
        const speed=Math.max(0.35,len/2), left=(len-f.distance)/speed;
        if (elapsed<left) {
          f.distance+=elapsed*speed;
          f.position=a.map((v,j)=>v+(b[j]-v)*f.distance/len) as Vector;
          break;
        }
        elapsed-=left;f.position=b;f.segment++;f.distance=0;
      }
      if (f.leg===f.trip.legs.length) {
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
