import { readFbx } from "./fbx-reader";

export function fbxGeometry(bytes: Buffer) {
  const scene = readFbx(bytes, "lookup");
  const vertices: number[][] = [], uvs: number[][] = [], objects = [];
  const aliases = scene.meshes.map(mesh => new Set(mesh.name ? [mesh.name] : []));
  for (const node of scene.nodes) if (node.mesh >= 0) aliases[node.mesh].add(node.name);
  for (const [index, mesh] of scene.meshes.entries()) {
    const firstVertex = vertices.length, firstUV = uvs.length, faces = [];
    for (let i = 0; i < mesh.positions.length; i += 3) vertices.push(Array.from(mesh.positions.subarray(i,i+3)));
    for (let i = 0; i < mesh.uvs.length; i += 2) uvs.push(Array.from(mesh.uvs.subarray(i,i+2)));
    for (const [begin, count] of mesh.faces) {
      const corners = Array.from({length:count}, (_,i)=>begin+i);
      faces.push({indices: corners.map(v=>firstVertex+mesh.vertexIndices[v]), texcoords: mesh.uvs.length ? corners.map(v=>firstUV+v) : [], material: ""});
    }
    for (const name of aliases[index]) objects.push({name, line:0, start:0, firstVertex, vertexCount:mesh.positions.length/3, faces});
  }
  return {vertices, uvs, objects, libraries:[]};
}
