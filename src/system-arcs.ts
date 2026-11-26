import {BufferGeometry,Color,Float32BufferAttribute,LineBasicMaterial,LineSegments,MathUtils} from "three";
import type {EntityObject} from "./entity-model";
import {previewLayer} from "./preview-display";

// Unit-radius guides in the preview's mirrored X, forward Z, up Y coordinates.
export function systemArcs(system:EntityObject) {
  const points:number[]=[], colors:number[]=[];
  function sector(text:string,vertical:boolean) {
    const color=new Color(vertical ? 0x71dfff : 0xffdf72);
    for (const item of text?.split("|") || []) {
      const pair=item.split(",").map(v=>v.trim() ? Number(v) : NaN);
      if (pair.length!==2 || !pair.every(Number.isFinite)) continue;
      const [start,end]=pair, delta=end-start;
      if (vertical && (delta<0 || start < -90 || end>90)) continue;
      const span=vertical ? delta : Math.abs(delta)>=360 ? 360 : MathUtils.euclideanModulo(delta,360);
      const steps=Math.max(1,Math.ceil(span/5));
      let previous=[0,0,0];
      for (let i=0;i<=steps;i++) {
        const a=MathUtils.degToRad(start+span*i/steps);
        const point=vertical ? [0,Math.sin(a),Math.cos(a)] : [-Math.sin(a),0,Math.cos(a)];
        points.push(...previous,...point); previous=point;
      }
      points.push(...previous,0,0,0);
      while (colors.length<points.length) colors.push(color.r,color.g,color.b);
    }
  }
  sector(system.firingArcs,false);
  sector(system.elevationArc,true);
  if (!points.length) return;
  const geometry=new BufferGeometry();
  geometry.setAttribute("position",new Float32BufferAttribute(points,3));
  geometry.setAttribute("color",new Float32BufferAttribute(colors,3));
  const guide=new LineSegments(geometry,new LineBasicMaterial({vertexColors:true,depthTest:false,depthWrite:false}));
  guide.layers.set(previewLayer.widget);
  guide.renderOrder=12;
  return guide;
}
