import { BoxGeometry, BufferAttribute, BufferGeometry, Group, MathUtils, Mesh, MeshPhongMaterial, RepeatWrapping, SphereGeometry, SRGBColorSpace, TextureLoader, type LoadingManager } from "three";
import type { EntityScene } from "./entity-model";
import type { OutlineNode } from "./model-outline";

function floats(encoded: string) {
  return new Float32Array(Uint8Array.from(atob(encoded), char=>char.charCodeAt(0)).buffer);
}

export function assembledEntity(scene: EntityScene, manager: LoadingManager) {
  const model = new Group(), outline: OutlineNode[] = [];
  const nodes = new Map<string,Group>(), rows = new Map<string,OutlineNode>();
  const meshes = scene.geometry.map(data=>{
    const geometry = new BufferGeometry();
    geometry.setAttribute("position",new BufferAttribute(floats(data.positions),3));
    geometry.setAttribute("uv",new BufferAttribute(floats(data.uvs),2));
    geometry.computeVertexNormals();
    return geometry;
  });
  const loader = new TextureLoader(manager);
  const textures = scene.textures.map(({png})=>{
    const texture = loader.load("data:image/png;base64,"+png);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    return texture;
  });
  for (const part of scene.parts) {
    const node = new Group();
    node.name = part.name;
    const [x,y,z] = part.position;
    node.position.set(-x,y,z);
    const [rx,ry,rz] = part.rotation.map(MathUtils.degToRad);
    node.rotation.set(rx,-ry,-rz,"YXZ");
    node.scale.fromArray(part.scale);
    const shape = part.primitive === "box" ? new BoxGeometry() : part.primitive === "sphere" ? new SphereGeometry(0.5) : meshes[part.geometry];
    if (shape) {
      const map = textures[part.texture];
      const alpha = scene.textures[part.texture]?.alpha;
      const surface = new Mesh(shape,new MeshPhongMaterial({color:part.collider ? 0xff833d : map ? 0xffffff : 0xaaaaaa,
        map:map || null, alphaTest:alpha === "cutout" ? 0.5 : 0, transparent:alpha === "blend", depthWrite:alpha !== "blend"}));
      surface.name = part.name;
      surface.userData.partId = part.id;
      node.add(surface);
    }
    nodes.set(part.id,node);
    rows.set(part.id,{name:part.name,children:[],parts:shape ? [{id:part.id,collider:part.collider}] : []});
  }
  for (const part of scene.parts) {
    (nodes.get(part.parent) || model).add(nodes.get(part.id));
    (rows.get(part.parent)?.children || outline).push(rows.get(part.id));
  }
  return {model,outline};
}
