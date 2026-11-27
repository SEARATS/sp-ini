import { Box3, BoxGeometry, BufferAttribute, BufferGeometry, ConeGeometry, Group, MathUtils, Mesh, MeshBasicMaterial, MeshPhongMaterial, OctahedronGeometry, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector3, type LoadingManager } from "three";
import type { EntityPart, EntityScene, Vector } from "./entity-model";
import type { OutlineNode } from "./model-outline";
import { objectColor, previewColors, type PreviewColor } from "./preview-colors";

function floats(encoded: string) {
  return new Float32Array(Uint8Array.from(atob(encoded), char=>char.charCodeAt(0)).buffer);
}

function transform(node:Group, position:Vector, rotation:Vector) {
  const [x,y,z]=position, [rx,ry,rz]=rotation.map(MathUtils.degToRad);
  node.position.set(-x,y,z);
  node.rotation.set(rx,-ry,-rz,"YXZ");
}

export function assembledEntity(scene: EntityScene, manager: LoadingManager) {
  const model = new Group();
  const tree = (name: string): OutlineNode => ({name, tree:true, children:[], parts:[]});
  const meshTree = tree("Meshes"), colliderTree = tree("Colliders"), objectTree = tree("Objects");
  const byId = new Map(scene.parts.map(part=>[part.id,part]));
  const nodes = new Map<string,Group>(), rows = new Map<string,OutlineNode>();
  const objectColliders = new Map<string,string[]>();
  const widgets = new Map<string,Mesh>(), surfaces = new Map<string,Mesh<BufferGeometry,MeshBasicMaterial | MeshPhongMaterial>>();
  const objectGroups = new Map((scene.objects || []).map(obj=>[obj.name.toLowerCase(),obj.group]));
  function colliderColor(part: EntityPart): PreviewColor {
    const owners = part.referencedBy || [];
    const groups = owners.map(name=>objectGroups.get(name.toLowerCase()));
    if (groups.includes("Weapons")) return "weapon";
    if (part.hullCollider) return "hull";
    if (groups.includes("Magazines")) return "magazine";
    if (groups.includes("Sensors")) return "sensor";
    if (owners.length) return "object";
    const magazineName = /(?:^|[^a-z])mag(?:azine)?(?:$|[^a-z])/i;
    if ([part.name,part.meshName].some(name=>name && magazineName.test(name))) return "magazine";
    return "unassigned";
  }
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
    transform(node,part.position,part.rotation);
    node.scale.fromArray(part.scale);
    nodes.set(part.id,node);
    rows.set(part.id,{name:part.name,meshName:part.meshName,entityId:part.id,children:[],parts:[],
      colliderStyle:part.collider ? colliderColor(part) : undefined});
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
      const divisions = MathUtils.clamp(Math.round(diameter / 0.05), 1, 4);
      if (!spheres.has(divisions)) spheres.set(divisions,new OctahedronGeometry(0.5,divisions-1));
      shape = spheres.get(divisions);
    }
    if (!shape) continue;
    const map = textures[part.texture];
    const alpha = scene.textures[part.texture]?.alpha;
    const surface = new Mesh(shape,part.collider
      ? new MeshBasicMaterial({color:previewColors[rows.get(part.id).colliderStyle]})
      : new MeshPhongMaterial({color:map ? 0xffffff : 0xaaaaaa, map:map || null, alphaTest:alpha === "cutout" ? 0.5 : 0,
        transparent:alpha === "blend", depthWrite:alpha !== "blend"}));
    if (part.missingDiffuse && !part.collider) surface.material.userData.missingDiffuse = true;
    for (const name of part.referencedBy || []) {
      const key = name.toLowerCase();
      if (!objectColliders.has(key)) objectColliders.set(key,[]);
      objectColliders.get(key).push(part.id);
    }
    surface.name = part.name;
    surface.userData.partId = part.id;
    surface.userData.previewRole = rows.get(part.id).colliderStyle;
    if (part.collider) surfaces.set(part.id,surface);
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
    const widget = new Mesh(shape,new MeshBasicMaterial({color:previewColors[objectColor(obj.group)],
      depthTest:false,depthWrite:false}));
    const [x,y,z] = obj.position;
    widget.position.set(-x,y,z);
    const scale = parent.matrixWorld.getMaxScaleOnAxis();
    widget.scale.setScalar(diameter*0.009/(scale || 1));
    widget.userData.partId=obj.id;
    widget.userData.widget=true;
    widget.userData.previewRole=objectColor(obj.group);
    widget.userData.colliderIds=objectColliders.get(obj.name.toLowerCase());
    widget.userData.color=widget.material.color.getHex();
    widget.renderOrder=10;
    parent.add(widget);
    widgets.set(obj.id,widget);
    row.parts.push({id:obj.id,collider:false,widget:true});
  }
  return {model,outline:[meshTree,colliderTree,objectTree],surfaces,nodes,widgets};
}

// Most INI edits only move parts, toggle visibility or change source lines. Keep their GPU assets.
export function patchEntity(view:ReturnType<typeof assembledEntity>, before:EntityScene, after:EntityScene) {
  const partShape = ({source,position,rotation,visible,...rest}:EntityPart)=>rest;
  const objectShape = ({source,position,placement,firingArcs,elevationArc,...rest}:NonNullable<EntityScene["objects"]>[number])=>({...rest,placed:!!position});
  if (before.geometry.length!==after.geometry.length || before.textures.length!==after.textures.length ||
    before.geometry.some((g,i)=>g.positions!==after.geometry[i].positions || g.uvs!==after.geometry[i].uvs) ||
    before.textures.some((t,i)=>t.png!==after.textures[i].png || t.alpha!==after.textures[i].alpha) ||
    JSON.stringify(before.parts.map(partShape))!==JSON.stringify(after.parts.map(partShape)) ||
    JSON.stringify(before.objects?.map(objectShape))!==JSON.stringify(after.objects?.map(objectShape))) return false;
  for (const part of after.parts) transform(view.nodes.get(part.id),part.position,part.rotation);
  for (const obj of after.objects || []) {
    if (obj.position) view.widgets.get(obj.id)?.position.set(-obj.position[0],obj.position[1],obj.position[2]);
  }
  return true;
}
