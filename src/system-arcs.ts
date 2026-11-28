import {BufferGeometry,Float32BufferAttribute,LineBasicMaterial,LineSegments,MathUtils,type Object3D} from "three";
import type {EntityObject} from "./entity-model";
import {previewLayer} from "./preview-display";
import {weaponArcColors} from "./preview-colors";

type Range = [number,number];

function angles(text:string):Range | undefined {
  if (text===undefined) return;
  const pair=text.split(",");
  if (pair.length<2) return [0,0];
  const number=(part:string)=>Number.isFinite(Number(part)) ? Number(part) : 0;
  return [number(pair[0]),number(pair[1])];
}

// IniHandler adapts each bearing once. WeaponSystem tests it against a signed relative heading.
function bearingRanges(text:string):Range[] {
  const ranges:Range[]=[];
  const adapt=(value:number)=>value>180 ? value-360 : value < -180 ? value+360 : value;
  for (const [index,item] of (text?.split("|") || []).entries()) {
    const pair=angles(item);
    if (!pair) continue;
    const [start,end]=pair.map(adapt);
    if (start===0 && end===0 && index>0) continue;
    if (start===end) return [[-180,180]];
    if (start<end) {
      if (start<180 && end>-180) ranges.push([Math.max(-180,start),Math.min(180,end)]);
    } else if (start<=180 && end>=-180) {
      ranges.push([start,end+360]);
    } else {
      if (start<=180) ranges.push([Math.max(-180,start),180]);
      if (end>=-180) ranges.push([-180,Math.min(180,end)]);
    }
  }
  return ranges;
}

export function systemArcs(system:EntityObject) {
  function guide(ranges:Range[],frame:"unit"|"mount") {
    const vertical=frame==="mount", points:number[]=[];
    for (const [start,end] of ranges) {
      const span=end-start;
      const steps=Math.max(1,Math.ceil(Math.min(span,360)/5));
      const point=(degrees:number)=>{
        const a=MathUtils.degToRad(degrees);
        return vertical ? [0,Math.sin(a),Math.cos(a)] : [-Math.sin(a),0,Math.cos(a)];
      };
      let previous=point(start);
      if (span<360) points.push(0,0,0,...previous);
      for (let i=1;i<=steps;i++) {
        const next=point(start+span*i/steps);
        points.push(...previous,...next); previous=next;
      }
      if (span<360) points.push(...previous,0,0,0);
    }
    const geometry=new BufferGeometry();
    geometry.setAttribute("position",new Float32BufferAttribute(points,3));
    const color=vertical ? weaponArcColors.elevation : weaponArcColors.bearing;
    const line=new LineSegments(geometry,new LineBasicMaterial({color,depthTest:false,depthWrite:false}));
    line.layers.set(previewLayer.arc);
    return {frame,line,color};
  }
  const arcs:ReturnType<typeof guide>[]=[];
  const bearings=bearingRanges(system.firingArcs), elevation=angles(system.elevationArc);
  if (bearings.length) arcs.push(guide(bearings,"unit"));
  if (elevation && elevation[0]<=elevation[1]) arcs.push(guide([elevation],"mount"));
  return arcs;
}

export function placeSystemArcs(arcs:ReturnType<typeof systemArcs>,unit:Object3D,mount:Object3D,radius:number) {
  for (const {frame,line} of arcs) {
    const origin=frame==="unit" ? unit : mount;
    // Show each sector at its mount while keeping the unit-relative bearing axes.
    mount.getWorldPosition(line.position);
    origin.getWorldQuaternion(line.quaternion);
    line.scale.setScalar(radius);
  }
}
