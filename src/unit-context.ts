import { sectionGroup, type IniSection } from "./ini";

export function unitSectionId(family: string, section: IniSection) {
  if (family === "sensors.ini") {
    const kind = section.keys.find(k => k.name.toLowerCase() === "kind")?.value;
    if (kind) return "kind:" + kind.toLowerCase();
  }
  return sectionGroup(section.name);
}

const number = /[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.source;
export const numericValue = new RegExp(`^${number}(?:\\s*,\\s*${number})*$`, "i");

// Units of the INI inputs, before FlightDeck converts speeds and waypoint coordinates.
const deckUnits:Record<string,Record<string,string>>={
  flightdeck:{
    launchdelay:"s",spawninterval:"s",landingdirection:"°",landingspeeds:"kt",
    forwardstaxivelocity:"kt",backwardstaxivelocity:"kt",slowtaxivelocity:"kt",
    holdstackseparation:"ft",helicopterholdstackseparation:"ft",holdenterdistance:"nmi",helicopterholdenterdistance:"nmi"
  },
  "recoverypoint#":{landinginterval:"s",position:"Unity units",exitposition:"Unity units",rotation:"°"},
  "launchpoint#":{takeofftime:"s",catapultparticlesduration:"s",nosegearparticlesduration:"s",
    position:"Unity units",holdposition:"Unity units",mintakeofflength:"Unity units",mintakeofflengthlarge:"Unity units",
    rotation:"°",vtol_rotation:"°",verticalrotation:"°"},
  "elevator#":{spawnposition:"Unity units",despawnposition:"Unity units",rideposition:"Unity units",recoveryposition:"Unity units",
    helicopterrideposition:"Unity units",helicopterrecoveryposition:"Unity units",spawnrotation:"°",returnrotation:"°"},
  "taxipoint#":{position:"Unity units"}
};
export function flightDeckUnit(section:string,key:string,value:string) {
  const path=(section==="flightdeck" && /^(?:(?:large|helicopter)?holdwaypoints|(?:plane|vtol|helicopter)initialwaypoint)$/.test(key)) ||
    (section==="recoverypoint#" && /^(?:large|helicopter)?circuitwaypoints$/.test(key));
  const taxi=section==="taxipath#" && key==="waypoints";
  if (path || taxi) {
    if (value.split("|").every(p=>numericValue.test(p.trim()) && p.split(",").length===3))
      return taxi ? "Unity units" : "nmi, ft, nmi";
    return;
  }
  if (numericValue.test(value)) return deckUnits[section]?.[key];
}
