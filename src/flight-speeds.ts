import { field, type Vector } from "./entity-model";
import type { IniSection, parse } from "./ini";

export type Craft="vtol"|"helicopter"|"plane"|"stol";
export type FlightPhase="forward"|"backward"|"slow"|"hold"|"circuit"|"approach"|"touchdown"|"departure";
export interface AircraftPerformance {name?:string; craft:Craft; maxKnots:number; climb:number; stall:number; warmup:number}
export interface DeckSpeeds {forward:number; backward:number; slow:number; hold:number; circuit:number; approach:number}
const knot=0.0076554087;
const positive=(value:string|undefined,fallback:number)=>Number(value)>0 && Number.isFinite(Number(value)) ? Number(value) : fallback;
const numeric=(s:IniSection,key:string,fallback:number)=>{
  const raw=field(s,key)?.value;
  return raw && Number.isFinite(Number(raw)) ? Number(raw) : fallback;
};

export function deckSpeeds(deck:IniSection):DeckSpeeds {
  const landing=field(deck,"landingspeeds")?.value.split(",") ?? [];
  return {forward:Math.max(2,numeric(deck,"forwardstaxivelocity",10)),backward:Math.max(2,-numeric(deck,"backwardstaxivelocity",-5)),
    slow:Math.max(2,numeric(deck,"slowtaxivelocity",5)),hold:positive(landing[0],250),circuit:positive(landing[1],300),approach:positive(landing[2],150)};
}

export function aircraftPerformance(craft:Craft,section?:IniSection,name?:string):AircraftPerformance {
  const heli=craft==="helicopter";
  const stall=positive(field(section,"stallspeed")?.value,114.65);
  const climb=heli ? positive(field(section,"climbrate")?.value,35.5)*0.00453571 :
    positive(field(section,"maxclimbrate")?.value,12.7)*0.0148809375;
  return {name,craft,stall,climb,maxKnots:positive(field(section,"maxspeedatsealevel")?.value,heli ? 138 : 601.4),
    warmup:Math.max(0,numeric(section,"enginewarmuptime",heli ? 30 : 20))+(heli ? Math.max(0,numeric(section,"rotorsspinuptime",30)) : 0)};
}

export function airGroupPerformance(name:string,doc:ReturnType<typeof parse>) {
  const section=(name:string)=>doc?.sections.find(s=>s.name.toLowerCase()===name);
  const kind=field(section("general"),"unittype")?.value.toLowerCase();
  const craft:Craft=kind==="aircraft" || kind==="plane" ? "plane" : kind as Craft;
  if (["vtol","stol","plane","helicopter"].includes(craft))
    return aircraftPerformance(craft,section(craft==="helicopter" ? "physics" : "performance"),name);
}

// Target speeds in hull-relative uu/s. Cube motion omits thrust, turns and ship motion.
export function flightSpeed(phase:FlightPhase, deck:DeckSpeeds, plane:AircraftPerformance, a:Vector,b:Vector,remaining:number,vertical:boolean) {
  if (phase==="forward" || phase==="backward" || phase==="slow") return deck[phase]*knot;
  const heli=plane.craft==="helicopter";
  let knots:number;
  if (phase==="departure") knots=heli ? plane.maxKnots : plane.stall*(plane.craft==="plane" ? 1.5 : 1.75);
  else if (phase==="touchdown" && heli) knots=5;
  else if (heli) knots=phase==="approach" ? Math.max(20,remaining*10) : 200;
  else if (vertical && (phase==="approach" || phase==="touchdown")) knots=60;
  else knots=deck[phase==="touchdown" ? "approach" : phase];
  const length=Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
  const rise=Math.abs(b[1]-a[1]);
  return Math.min(knots*knot,plane.maxKnots*knot,rise>0 ? plane.climb*length/rise : Infinity);
}
