import { parseBinary, parseText, FBXNode } from "fbx-parser";

export const fbxTree = (bytes: Buffer) => bytes.subarray(0,18).toString()==="Kaydara FBX Binary" ?
  parseBinary(bytes) : parseText(bytes.toString("utf8"));
function array(node: FBXNode,key: string): number[] {
  const value = node?.nodes.find(n=>n.name===key)?.props[0];
  return Array.isArray(value) ? value as number[] : [];
}
export function fbxGeometry(bytes: Buffer) {
  const tree = fbxTree(bytes), nodes = tree.find(n=>n.name==="Objects")?.nodes || [];
  const links = tree.find(n=>n.name==="Connections")?.nodes || [];
  const label = (value: unknown) => String(value).split("\0",1)[0].replace(/^(?:Model|Geometry)::/,"");
  const names = new Map(nodes.filter(n=>n.name==="Model").map(n=>[String(n.props[0]),label(n.props[1])]));
  const owners = new Map(links.filter(n=>n.props[0]==="OO").map(n=>[String(n.props[1]),names.get(String(n.props[2]))]));
  const vertices: number[][] = [], uvs: number[][] = [], objects = [];
  for (const geometry of nodes.filter(n=>n.name==="Geometry" && n.props[2]==="Mesh")) {
    const coords = array(geometry,"Vertices"), indices = array(geometry,"PolygonVertexIndex");
    const uv = geometry.nodes.find(n=>n.name==="LayerElementUV");
    const tex = array(uv,"UV"), texIndices = array(uv,"UVIndex");
    const mapping = uv?.nodes.find(n=>n.name==="MappingInformationType")?.props[0];
    const firstVertex=vertices.length, firstUV=uvs.length;
    for(let i=0;i<coords.length;i+=3) vertices.push(coords.slice(i,i+3));
    for(let i=0;i<tex.length;i+=2) uvs.push(tex.slice(i,i+2));
    const faces = [];
    let face = [], texcoords = [];
    for (const [i,raw] of indices.entries()) {
      const v = raw<0 ? -raw-1 : raw;
      const t = mapping==="ByVertice" || mapping==="ByControlPoint" ? v : i;
      face.push(firstVertex+v);
      texcoords.push(firstUV+(texIndices[t] ?? t));
      if (raw<0) { faces.push({indices: face,texcoords,material:""}); face=[]; texcoords=[]; }
    }
    const owner = owners.get(String(geometry.props[0]));
    const name = label(geometry.props[1]) || owner;
    for (const alias of new Set([name,owner].filter(Boolean))) objects.push({name:alias,line:0,start:0,firstVertex,vertexCount:coords.length/3,faces});
  }
  return {vertices,uvs,objects,libraries:[]};
}
