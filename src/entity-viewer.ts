import { Box3, BoxGeometry, BufferAttribute, BufferGeometry, ConeGeometry, Group, MathUtils, Mesh, MeshBasicMaterial, MeshPhongMaterial, OctahedronGeometry, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector3, type LoadingManager } from "three";
import type { EntityScene } from "./entity-model";
import type { OutlineNode } from "./model-outline";

function floats(encoded: string) {
  return new Float32Array(Uint8Array.from(atob(encoded), char=>char.charCodeAt(0)).buffer);
}

export function assembledEntity(scene: EntityScene, manager: LoadingManager) {
  const model = new Group();
  const tree = (name: string): OutlineNode => ({name, tree:true, children:[], parts:[]});
  const meshTree = tree("Meshes"), colliderTree = tree("Colliders"), objectTree = tree("Objects");
  const byId = new Map(scene.parts.map(part=>[part.id,part]));
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
    nodes.set(part.id,node);
    rows.set(part.id,{name:part.name,entityId:part.id,children:[],parts:[]});
  }
  for (const part of scene.parts) {
    (nodes.get(part.parent) || model).add(nodes.get(part.id));
    const branch = part.collider ? colliderTree : meshTree;
    let parent = byId.get(part.parent);
    while (parent && parent.collider !== part.collider) parent = byId.get(parent.parent);
    (rows.get(parent?.id) || branch).children.push(rows.get(part.id));
  }
  model.updateMatrixWorld(true);
  const spheres = new Map<number,OctahedronGeometry>();
  for (const part of scene.parts) {
    const node = nodes.get(part.id);
    let shape = meshes[part.geometry];
    if (part.primitive === "box") shape = new BoxGeometry();
    if (part.primitive === "sphere") {
      // The unit sphere has diameter 1. Use the scaled diameter in Sea Power model units.
      const diameter = node.matrixWorld.getMaxScaleOnAxis();
      const divisions = MathUtils.clamp(Math.round(diameter / 0.025), 2, 8);
      if (!spheres.has(divisions)) spheres.set(divisions,new OctahedronGeometry(0.5,divisions-1));
      shape = spheres.get(divisions);
    }
    if (!shape) continue;
    const map = textures[part.texture];
    const alpha = scene.textures[part.texture]?.alpha;
    const surface = new Mesh(shape,new MeshPhongMaterial({color:part.collider ? 0xff833d : map ? 0xffffff : 0xaaaaaa,
      map:map || null, alphaTest:alpha === "cutout" ? 0.5 : 0, transparent:alpha === "blend", depthWrite:alpha !== "blend"}));
    surface.name = part.name;
    surface.userData.partId = part.id;
    node.add(surface);
    rows.get(part.id).parts.push({id:part.id,collider:part.collider});
  }
  const diameter = new Box3().setFromObject(model).getSize(new Vector3()).length() || 1;
  const groups = new Map<string,OutlineNode>();
  for (const obj of scene.objects || []) {
    if (!groups.has(obj.group)) {
      const group: OutlineNode = {name:obj.group, children:[], parts:[]};
      groups.set(obj.group,group);
      objectTree.children.push(group);
    }
    const row: OutlineNode = {name:[obj.name,obj.system].filter(Boolean).join(" · "),entityId:obj.id,children:[],parts:[]};
    groups.get(obj.group).children.push(row);
    const parent = nodes.get(obj.anchor);
    if (!obj.position || !parent) continue;
    const sensor = obj.group === "Sensors", weapon = obj.group === "Weapons";
    const shape = sensor ? new OctahedronGeometry(1) : weapon ? new ConeGeometry(1,2,4) : new BoxGeometry(1.5,1.5,1.5);
    const widget = new Mesh(shape,new MeshBasicMaterial({color:sensor ? 0x53c8fa : weapon ? 0xff6887 : 0xc6a2ff,
      depthTest:false,depthWrite:false}));
    const [x,y,z] = obj.position;
    widget.position.set(-x,y,z);
    const scale = parent.matrixWorld.getMaxScaleOnAxis();
    widget.scale.setScalar(diameter*0.009/(scale || 1));
    widget.userData.partId=obj.id;
    widget.userData.widget=true;
    widget.userData.color=widget.material.color.getHex();
    widget.renderOrder=10;
    parent.add(widget);
    row.parts.push({id:obj.id,collider:false,widget:true});
  }
  return {model,outline:[meshTree,colliderTree,objectTree]};
}
