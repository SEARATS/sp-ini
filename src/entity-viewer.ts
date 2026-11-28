import { Box3, BoxGeometry, BufferAttribute, BufferGeometry, ConeGeometry, DoubleSide, Float32BufferAttribute, Group, Line, LineBasicMaterial, MathUtils, Mesh, MeshBasicMaterial, MeshPhongMaterial, OctahedronGeometry, PlaneGeometry, Quaternion, RepeatWrapping, Sphere, SRGBColorSpace, TextureLoader, Vector3, type LoadingManager } from "three";
import { deckPointSection, type EntityObject, type EntityPart, type EntityScene, type EntitySpin, type Vector } from "./entity-model";
import type { OutlineNode } from "./model-outline";
import { deckPointColor, objectColor, previewColors, type PreviewColor } from "./preview-colors";

function floats(encoded: string) {
  return new Float32Array(Uint8Array.from(atob(encoded), char=>char.charCodeAt(0)).buffer);
}

function transform(node:Group, position:Vector, rotation:Vector) {
  const [x,y,z]=position, [rx,ry,rz]=rotation.map(MathUtils.degToRad);
  node.position.set(-x,y,z);
  node.rotation.set(rx,-ry,-rz,"YXZ");
}

export function entityGeometry(data: EntityScene["geometry"][number]) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position",new BufferAttribute(floats(data.positions),3));
  geometry.setAttribute("uv",new BufferAttribute(floats(data.uvs),2));
  if (data.normals) geometry.setAttribute("normal",new BufferAttribute(floats(data.normals),3));
  else geometry.computeVertexNormals();
  return geometry;
}

/** Bind after applying the INI pose. Reflecting Unity's X flips rotation about Y and Z. */
export function bindEntitySpins(nodes:Map<string,Group>, spins:EntitySpin[] = []) {
  const axes = {x:new Vector3(1,0,0),y:new Vector3(0,-1,0),z:new Vector3(0,0,-1)};
  const tracks = spins.flatMap(({part,axis,rpm})=>{
    const node = nodes.get(part);
    return node ? [{node,rest:node.quaternion.clone(),axis:axes[axis],rpm}] : [];
  });
  const turn = new Quaternion();
  if (tracks.length) return (seconds:number)=>{
    for (const {node,rest,axis,rpm} of tracks) {
      turn.setFromAxisAngle(axis,((seconds * rpm / 60) % 1) * 2 * Math.PI);
      node.quaternion.copy(rest).multiply(turn);
    }
  };
}

// Give each taxi segment a narrow, pickable surface in the deck plane.
function taxiGeometry(points:Vector[], width:number) {
  const geometry = new BufferGeometry(), vertices:number[] = [], indices:number[] = [];
  const [x,y,z] = points[0];
  for (let i=1;i<points.length;i++) {
    const a = points[i-1], b = points[i];
    const dx = a[0]-b[0], dz = b[2]-a[2], length = Math.hypot(dx,dz);
    const sideX = length ? dz/length * width/2 : width/2, sideZ = length ? -dx/length * width/2 : 0;
    const start = vertices.length/3;
    for (const p of [a,b]) for (const sign of [-1,1])
      vertices.push(x-p[0]+sign*sideX,p[1]-y,p[2]-z+sign*sideZ);
    indices.push(start,start+1,start+2,start+1,start+3,start+2);
  }
  geometry.setAttribute("position",new Float32BufferAttribute(vertices,3));
  geometry.setIndex(indices);
  return geometry;
}

function routeGeometry(route:EntityObject["route"],width:number) {
  const {points,kind} = route;
  if (points.length===1) return new PlaneGeometry(width*4,width*4).rotateX(-Math.PI/2);
  if (kind==="taxiPaths") return taxiGeometry(points,width);
  const [x,y,z] = points[0];
  return new BufferGeometry().setFromPoints(points.map(p=>new Vector3(x-p[0],p[1]-y,p[2]-z)));
}

export function entityBounds(model:Group, includeAir = false) {
  const box = new Box3();
  model.updateMatrixWorld(true);
  model.traverse(node=>{
    if ((node instanceof Mesh || node instanceof Line) &&
      (node.userData.routeKind!=="airPaths" || (includeAir && node.layers.mask))) box.expandByObject(node);
  });
  return box.getBoundingSphere(new Sphere());
}

export function assembledEntity(scene: EntityScene, manager: LoadingManager, meshes = scene.geometry.map(entityGeometry)) {
  const model = new Group();
  const tree = (name: string): OutlineNode => ({name, tree:true, children:[], parts:[]});
  const meshTree = tree("Meshes"), colliderTree = tree("Colliders"), objectTree = tree("Objects");
  const byId = new Map(scene.parts.map(part=>[part.id,part]));
  const nodes = new Map<string,Group>(), rows = new Map<string,OutlineNode>();
  const objectColliders = new Map<string,string[]>();
  const widgets = new Map<string,Mesh | Line>(), surfaces = new Map<string,Mesh<BufferGeometry,MeshBasicMaterial | MeshPhongMaterial>>();
  const objectGroups = new Map((scene.objects || []).map(obj=>[obj.name.toLowerCase(),obj.group]));
  function colliderColor(part: EntityPart): PreviewColor {
    const owners = part.referencedBy || [];
    const groups = owners.map(name=>objectGroups.get(name.toLowerCase()));
    if (groups.includes("Weapons")) return "weapon";
    if (part.hullCollider) return "hull";
    if (groups.includes("Magazines")) return "magazine";
    if (groups.includes("Sensors")) return "sensor";
    if (groups.includes("Flight deck")) return "flight";
    if (owners.length) return "object";
    const magazineName = /(?:^|[^a-z])mag(?:azine)?(?:$|[^a-z])/i;
    if ([part.name,part.meshName].some(name=>name && magazineName.test(name))) return "magazine";
    return "unassigned";
  }
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
    surface.castShadow = !part.collider && part.castShadows !== false;
    surface.receiveShadow = !part.collider;
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
    const role = objectColor(obj.group);
    const deckPoint = deckPointSection.test(obj.name);
    const size = diameter*0.009/(parent.matrixWorld.getMaxScaleOnAxis() || 1);
    const shape = obj.route ? routeGeometry(obj.route,size*0.26) :
      deckPoint ? new PlaneGeometry(1.7,1.7).rotateX(-Math.PI/2) :
      role==="sensor" ? new OctahedronGeometry(1) : role==="weapon" ? new ConeGeometry(1,2,4) : new BoxGeometry(1.5,1.5,1.5);
    const style = {color:deckPoint || obj.route ? deckPointColor : previewColors[role],depthTest:!!obj.route,depthWrite:false};
    const widget = obj.route?.kind==="airPaths" && obj.route.points.length>1
      ? new Line(shape,new LineBasicMaterial(style))
      : new Mesh(shape,new MeshBasicMaterial({...style,polygonOffset:!!obj.route,polygonOffsetFactor:-1,polygonOffsetUnits:-1,
        ...(deckPoint || obj.route ? {side:DoubleSide} : {})}));
    const [x,y,z] = obj.position;
    widget.position.set(-x,y,z);
    if (obj.route) {
      widget.userData.pathWidth = size*0.26;
      widget.userData.routeKind = obj.route.kind;
    }
    else widget.scale.setScalar(size);
    widget.userData.partId=obj.id;
    widget.userData.widget=true;
    widget.userData.previewRole=role;
    if (!deckPoint && !obj.route) widget.userData.colliderIds=objectColliders.get(obj.name.toLowerCase());
    widget.userData.color=widget.material.color.getHex();
    widget.userData.deckPoint=deckPoint;
    widget.renderOrder=deckPoint ? 14 : obj.route ? 9 : 10;
    parent.add(widget);
    widgets.set(obj.id,widget);
    row.parts.push({id:obj.id,collider:false,widget:true,routeKind:obj.route?.kind});
  }
  return {model,outline:[meshTree,colliderTree,objectTree],surfaces,nodes,widgets};
}

// Most INI edits only move parts, toggle visibility or change source lines. Keep their GPU assets.
export function patchEntity(view:ReturnType<typeof assembledEntity>, before:EntityScene, after:EntityScene) {
  const partShape = ({source,position,rotation,visible,...rest}:EntityPart)=>rest;
  const objectShape = ({source,position,placement,firingArcs,elevationArc,route,...rest}:EntityObject)=>({...rest,placed:!!position,kind:route?.kind,single:route?.points.length===1});
  if (before.geometry.length!==after.geometry.length || before.textures.length!==after.textures.length ||
    before.geometry.some((g,i)=>g.positions!==after.geometry[i].positions || g.uvs!==after.geometry[i].uvs || g.normals!==after.geometry[i].normals) ||
    before.textures.some((t,i)=>t.png!==after.textures[i].png || t.alpha!==after.textures[i].alpha) ||
    JSON.stringify(before.parts.map(partShape))!==JSON.stringify(after.parts.map(partShape)) ||
    JSON.stringify(before.objects?.map(objectShape))!==JSON.stringify(after.objects?.map(objectShape))) return false;
  for (const part of after.parts) transform(view.nodes.get(part.id),part.position,part.rotation);
  for (const [i,obj] of (after.objects || []).entries()) {
    const widget = view.widgets.get(obj.id);
    if (!widget || !obj.position) continue;
    widget.position.set(-obj.position[0],obj.position[1],obj.position[2]);
    if (obj.route && JSON.stringify(obj.route.points)!==JSON.stringify(before.objects[i].route.points)) {
      widget.geometry.dispose();
      widget.geometry = routeGeometry(obj.route,widget.userData.pathWidth);
    }
  }
  return true;
}
