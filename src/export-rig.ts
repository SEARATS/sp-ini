import { Box3, Matrix4, Vector3 } from "three";
import type { EntityScene } from "./entity-model";
import { readFbx } from "./fbx-reader";
import { fbxBasis } from "./fbx-scene";
import { assignPaths, flatten, sceneHierarchy, type ModelNode } from "./hierarchy";
import { objectHeader, parseObj, triangles } from "./meshes";

export interface RigAssets {
  geometry: EntityScene["geometry"];
  names: [string, number][];
}
export interface MeshBounds { center:number[]; pivot:number[]; size:number[]; diameter:number }

/** Both shapes use the midpoint of the model-axis bounds. Fit the sphere to actual vertices. */
function fit(points:Float32Array, pivot:Vector3): MeshBounds {
  const box = new Box3().setFromArray(points), center = box.getCenter(new Vector3()), point = new Vector3();
  let radiusSq = 0;
  for (let i = 0; i < points.length; i += 3) radiusSq = Math.max(radiusSq,point.fromArray(points,i).distanceToSquared(center));
  center.x = -center.x; // Three.js to Sea Power's left-handed coordinates.
  return {center:center.toArray(),pivot:[-pivot.x,pivot.y,pivot.z],size:box.getSize(new Vector3()).toArray(),diameter:2*Math.sqrt(radiusSq)};
}

export function readExportGeometry(filename:string, bytes:Buffer) {
  const geometry: RigAssets["geometry"] = [], names = new Map<string,number>(), bounds = new Map<string,MeshBounds>();
  if (/\.obj$/i.test(filename)) {
    const text = bytes.toString("utf8"), model = parseObj(text,!text.split(/\r?\n/).some(line => objectHeader.test(line)));
    const roots = assignPaths(model.objects.map((o,i) => ({id:String(i),name:o.name,mesh:o.name,path:"",position:[0,0,0],children:[]})));
    for (const [i,obj] of model.objects.entries()) {
      const data = triangles(model,obj);
      if (!data) continue;
      const positions = Buffer.from(data.positions,"base64");
      bounds.set(roots[i].path,fit(new Float32Array(positions.buffer,positions.byteOffset,positions.length/4),new Vector3()));
      if (!names.has(obj.name)) names.set(obj.name,geometry.push(data)-1);
    }
  } else {
    const scene = readFbx(bytes,"preview"), roots = sceneHierarchy(scene);
    const sources = new Map(scene.nodes.map(n => [n.id,n]));
    const point = new Vector3();
    function visit(node:ModelNode, parent:Matrix4) {
      const source = sources.get(node.id), world = parent.clone().multiply(new Matrix4().fromArray(source.local));
      const mesh = scene.meshes[source.mesh];
      if (mesh?.indices.length) {
        const matrix = world.clone().multiply(new Matrix4().fromArray(source.geometric));
        const pivot = new Vector3().setFromMatrixPosition(world);
        const points = new Float32Array(mesh.indices.length*3), uvs = new Float32Array(mesh.indices.length*2);
        const mirrored = matrix.determinant() < 0;
        for (let i=0; i<mesh.indices.length; i++) {
          const corner = i%3;
          const index = mesh.indices[mirrored && corner ? i + (corner === 1 ? 1 : -1) : i];
          point.fromArray(mesh.positions,index*3).applyMatrix4(matrix).sub(pivot).toArray(points,i*3);
          if (mesh.uvs.length) { uvs[i*2]=mesh.uvs[index*2]; uvs[i*2+1]=mesh.uvs[index*2+1]; }
        }
        bounds.set(node.path,fit(points,pivot));
        if (!names.has(node.name)) names.set(node.name,geometry.push({positions:Buffer.from(points.buffer).toString("base64"),uvs:Buffer.from(uvs.buffer).toString("base64")})-1);
      }
      node.children.forEach(child => visit(child,world));
    }
    const basis = fbxBasis(scene.axes);
    roots.forEach(node => visit(node,basis));
    for (const node of flatten(roots)) if (names.has(node.name) && node.mesh && !names.has(node.mesh)) names.set(node.mesh,names.get(node.name));
  }
  const assets:RigAssets = {geometry,names:[...names]};
  return {assets,bounds};
}
