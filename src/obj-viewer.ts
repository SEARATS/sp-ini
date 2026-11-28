import type { ModelSourceChoice } from "./entity-resources";
import { previewFbx } from "./fbx-scene";
import { loadObjDiffuseMaps, previewObj } from "./obj-geometry";
import { isMissingTextureColor, markMissingMaps, type MissingTextureColor } from "./missing-textures";
import { objLayout, type OutlineNode, type PreviewPart } from "./model-outline";
import { meshFlagMatcher } from "./mesh-flags";
import { orderedSiblings } from "./mesh-order";
import { meshMoveButtons } from "./mesh-move-buttons";
import { colliderType, type MeshTags } from "./mesh-names";
import { applyDisplay, previewLayer, type DisplaySettings } from "./preview-display";
import { assembledEntity, bindEntitySpins, elevatorClips, entityBounds, entityGeometry, entityTexture, patchEntity, poseElevator } from "./entity-viewer";
import type { EntityScene } from "./entity-model";
import { EntityStream } from "./entity-stream";
import { DeckPlayback, FlightNetwork } from "./flight-traffic";
import { entityModes, excludedOverlays, type EntityMode } from "./entity-mode";
import { previewColors, weaponArcColors } from "./preview-colors";
import { inspectEntity } from "./entity-inspect";
import {placeSystemArcs,systemArcs} from "./system-arcs";
import { Texture, TextureLoader, Box3, BoxGeometry, Color, Group, LoadingManager, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Sphere, WebGLRenderer } from "three";
import { previewDaylight, fitEntityShadows, renderDaylight } from "./preview-lighting";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

type SavedDisplay = Partial<DisplaySettings> & {mode?: EntityMode; animations?:boolean; aircraft?:boolean; elevatorPoses?:Record<string,string>; hidden?: string[]; wireframe?: boolean; entity?: string; appearance?: string; modelSources?:Record<string,string>};
declare function acquireVsCodeApi(): { postMessage(message: unknown): void; getState(): SavedDisplay | undefined; setState(value: SavedDisplay): void };
const vscode = acquireVsCodeApi();
const status = document.querySelector("[role=status]");
const fit = document.querySelector("button");
const canvas = document.querySelector("canvas");
const outline = document.querySelector<HTMLDetailsElement>("#outline");
const textureSelect = document.querySelector<HTMLSelectElement>("#missing-texture");
let missingTextureColor: MissingTextureColor = "grey";
textureSelect.onchange = () => vscode.postMessage({type:"setMissingTextureColor", value:textureSelect.value});
const scene = new Scene();
const sun = previewDaylight(scene);
const camera = new PerspectiveCamera(42, 1, 0.01, 10000);
const bounds = new Sphere();
let renderer, controls, model;
const objectLabels = new Map<string,HTMLElement>();
const trafficGroup=new Group(), tokenShape=new BoxGeometry();
const tokenMaterials={launch:new MeshBasicMaterial({color:0x66dcb1}),recovery:new MeshBasicMaterial({color:0xe1acfc})};
const activity=document.getElementById("flight-activity");
scene.add(trafficGroup);
trafficGroup.matrixAutoUpdate=false;
let network:FlightNetwork, traffic:DeckPlayback, layoutKey:string;
let connectedObjects:ReadonlySet<string>;
function trafficVisible() {
  return aircraftToggle.checked && (mode==="Everything" || mode==="Flight") && (!pickedObject || !hidden.has(pickedObject));
}
function drawTraffic(dt:number) {
  trafficGroup.visible=!!(traffic?.playable && trafficVisible());
  if (!trafficGroup.visible) {activity.hidden=true;return;}
  const root=active.view.nodes.get("models");
  if (!root) return;
  root.updateWorldMatrix(true,false);
  trafficGroup.matrix.copy(root.matrixWorld);
  trafficGroup.matrixWorldNeedsUpdate=true;
  traffic.tick(dt);
  const size=bounds.radius*0.022/(root.matrixWorld.getMaxScaleOnAxis() || 1);
  while (trafficGroup.children.length<traffic.flights.length) {
    const cube=new Mesh(tokenShape,tokenMaterials.launch);
    cube.layers.set(previewLayer.aircraft);
    cube.renderOrder=15;
    trafficGroup.add(cube);
  }
  trafficGroup.children.forEach((child,i)=>{
    const cube=child as Mesh, flight=traffic.flights[i];
    cube.visible=!!flight && (flight.trip.operation==="recovery" || flight.returnTime===undefined);
    if (!flight) return;
    cube.material=tokenMaterials[flight.trip.operation];
    const [x,y,z]=flight.position;
    cube.position.set(-x,y+size/2,z);
    cube.scale.setScalar(size);
  });
  activity.hidden=!traffic.focus || !traffic.flights.length;
  if (!activity.hidden) {
    const {craft,operation}=traffic.flights[0].trip;
    const text={vtol:"VTOL",stol:"STOL",helicopter:"Helicopter",plane:"Plane"}[craft]+" · "+(operation==="launch" ? "Launch" : "Recovery");
    const name=traffic.flights[0].aircraft.name;
    const label=name ? text+" · "+name : text;
    if (activity.textContent!==label) activity.textContent=label;
  }
}
function focusTraffic() {
  if (!network || (pickedObject && !network.links.has(pickedObject) && !network.deck.spots.some(s=>"object:"+s.name===pickedObject))) traffic=undefined;
  else if (traffic?.focus!==pickedObject || traffic?.network!==network) traffic=new DeckPlayback(network,pickedObject);
  connectedObjects=network?.related(pickedObject);
  for (const label of elevatorPanel.querySelectorAll<HTMLElement>("[data-elevator]"))
    label.classList.toggle("connected-object",!!connectedObjects?.has(label.dataset.elevator));
  for (const [id,label] of objectLabels) label.classList.toggle("connected-object",!!connectedObjects?.has(id));
  active?.view.widgets.forEach(styleWidget);
  drawTraffic(0);
  syncPlayback();
}
let active: {id:string; scene:EntityScene; view:ReturnType<typeof assembledEntity>};
let bright:string[] = [], pickedObject:string;
let hoveredWidget:string;
const arcGuides=new Map<string,{guides:ReturnType<typeof systemArcs>;firingArcs?:string;elevationArc?:string}>();
const arcValues=document.querySelector<HTMLElement>("#arc-values");
function syncArcs() {
  const unused=new Set(arcGuides.keys());
  for (const obj of active.scene.objects || []) {
    const anchor=active.view.widgets.get(obj.id);
    if (!anchor || !(obj.firingArcs || obj.elevationArc)) continue;
    let entry=arcGuides.get(obj.id);
    unused.delete(obj.id);
    if (!entry || entry.firingArcs!==obj.firingArcs || entry.elevationArc!==obj.elevationArc) {
      if (entry) removeArc(obj.id);
      const guides=systemArcs(obj);
      if (!guides.length) continue;
      entry={guides,firingArcs:obj.firingArcs,elevationArc:obj.elevationArc};
      arcGuides.set(obj.id,entry);
      for (const {line} of guides) scene.add(line);
    }
    placeSystemArcs(entry.guides,active.view.model,anchor,bounds.radius*0.17);
  }
  unused.forEach(removeArc);
}
function removeArc(id:string) {
  const entry=arcGuides.get(id);
  if (!entry) return;
  for (const {line} of entry.guides) {
    scene.remove(line); line.geometry.dispose(); line.material.dispose();
  }
  arcGuides.delete(id);
}
function showArcValues() {
  const obj=active?.scene.objects?.find(obj=>obj.id===pickedObject);
  arcValues.replaceChildren();
  if (!obj) return;
  for (const [label,value,color] of [["FiringArcs",obj.firingArcs,weaponArcColors.bearing],["ElevationArc",obj.elevationArc,weaponArcColors.elevation]] as const) {
    if (!value) continue;
    const span=document.createElement("span");
    span.style.color="#"+color.toString(16); span.textContent=label+"="+value; arcValues.append(span,"  ");
  }
}
const white=new Color(0xffffff);
const connectedBlue=new Color(0x85c4ff);
function styleWidget(node) {
  const {partId,deckPoint,pathWidth,color}=node.userData;
  const selected=partId===pickedObject, hovered=partId===hoveredWidget, connected=connectedObjects?.has(partId);
  node.material.color.set(selected ? 0xffff77 : color);
  if (hovered) node.material.color.lerp(white,0.55);
  else if (!selected && connected) node.material.color.lerp(connectedBlue,0.48);
  // Shared routes often overlap exactly. Paint the active states over their idle siblings.
  const emphasis=hovered ? 0.75 : selected ? 0.5 : connected ? 0.25 : 0;
  node.renderOrder=(deckPoint ? 14 : pathWidth ? 9 : 10)+emphasis;
}
function highlight(ids:string[]) {
  const next=ids.filter(id=>active?.view.surfaces.get(id)?.layers.isEnabled(previewLayer.collider));
  const widget=active?.view.widgets.get(ids[0]);
  const nextWidget=widget?.layers.mask ? ids[0] : undefined;
  if (nextWidget===hoveredWidget && next.length===bright.length && next.every((id,i)=>id===bright[i])) return;
  const previous=active?.view.widgets.get(hoveredWidget);
  hoveredWidget=nextWidget;
  if (previous) styleWidget(previous);
  if (widget) styleWidget(widget);
  for (const id of new Set([...bright,...next])) {
    const surface=active?.view.surfaces.get(id);
    if (!surface) continue;
    const rank=next.indexOf(id);
    surface.material.color.set(previewColors[surface.userData.previewRole]).lerp(white,rank===0 ? 0.36 : rank>0 ? 0.15 : 0);
    if (rank===0) surface.layers.enable(previewLayer.highlight);
    else surface.layers.disable(previewLayer.highlight);
  }
  bright=next;
  if (renderer) render();
}
const inspector = inspectEntity(canvas,camera,()=>model,()=>active?.view.widgets.values() ?? [],id=>vscode.postMessage({type:"openEntityPart",id}),id=>selectObject(id,true),highlight,
  id=>!excluded.has(id));
function selectObject(id: string | undefined, reveal: boolean) {
  const selected = objectLabels.get(id);
  if (id && !selected) return;
  pickedObject=id;
  focusTraffic();
  showArcValues();
  for (const label of objectLabels.values()) label.classList.toggle("selected-object",label === selected);
  if (reveal && selected) {
    for (let el: HTMLElement = selected; el; el=el.parentElement) if (el instanceof HTMLDetailsElement) el.open=true;
    selected.scrollIntoView({block:"nearest"});
  }
  if (renderer) draw();
}
const saved = vscode.getState();
const animationToggle = document.querySelector<HTMLInputElement>("#animations");
animationToggle.checked = saved?.animations ?? true;
const aircraftToggle=document.querySelector<HTMLInputElement>("#aircraft");
aircraftToggle.checked=saved?.aircraft ?? true;
let sampleSpins:ReturnType<typeof bindEntitySpins>, animationFrame:number, previousFrame:number;
let animationSeconds = 0;
document.addEventListener("keydown",event=>{if (event.key==="Escape" && pickedObject) selectObject(undefined,false);});
function animate(now:number) {
  const delta=(now-previousFrame)/1000;
  if (animationToggle.checked) animationSeconds += delta;
  drawTraffic(delta);
  previousFrame = now;
  if (animationToggle.checked) sampleSpins?.(animationSeconds);
  for (const [name,lift] of liftStates) {
    if (!lift.play) continue;
    const pose=trafficGroup.visible && traffic.elevators.get(name.toLowerCase());
    if (pose) lift.play(pose.time,pose.motion);
    else if (animationToggle.checked) lift.play(animationSeconds-lift.started);
  }
  if (settings.arcs) for (const [id,{guides}] of arcGuides)
    placeSystemArcs(guides,active.view.model,active.view.widgets.get(id),bounds.radius*0.17);
  if (sun.castShadow) renderer.shadowMap.needsUpdate = true;
  render();
  animationFrame = requestAnimationFrame(animate);
}
function syncPlayback() {
  cancelAnimationFrame(animationFrame);
  const playable=!!sampleSpins || [...liftStates.values()].some(lift=>lift.play);
  document.getElementById("animation-filter").hidden = !playable;
  document.getElementById("aircraft-filter").hidden=!network?.deck.spots.some(s=>s.types.length);
  if (((playable && animationToggle.checked) || (traffic?.playable && trafficVisible())) && !document.hidden) {
    previousFrame = performance.now();
    animationFrame = requestAnimationFrame(animate);
  }
}
animationToggle.onchange = aircraftToggle.onchange = changed;
document.addEventListener("visibilitychange",syncPlayback);
let mode: EntityMode = entityModes.includes(saved?.mode) ? saved.mode : "Everything";
let excluded = new Set<string>();
const modeSelect = document.querySelector<HTMLSelectElement>("#entity-mode");
modeSelect.value = mode;
modeSelect.onchange = () => {
  mode = modeSelect.value as EntityMode;
  if (active) {
    excluded = excludedOverlays(active.scene, mode);
    if (excluded.has(pickedObject)) selectObject(undefined,false);
    inspector.refreshLinks(outline);
  }
  changed();
};
let selectedEntity = saved?.entity, selectedAppearance = saved?.appearance;
let selectedSources:Record<string,string> = saved?.modelSources ?? {};
let initializedEntity = saved?.entity;
const picker = document.querySelector<HTMLElement>("#entity-pickers");
const entitySelect = picker.querySelector<HTMLSelectElement>("#entity"), appearanceSelect = picker.querySelector<HTMLSelectElement>("#appearance");
const warnings = document.querySelector<HTMLDetailsElement>("#entity-warnings");
const elevatorPanel=document.querySelector<HTMLDetailsElement>("#elevators");
const liftStates=new Map<string,{value:string; started:number; play?:ReturnType<typeof poseElevator>}>();
function showElevators(next:EntityScene,same:boolean) {
  const previous=new Map(liftStates);
  liftStates.clear();
  const rows=(next.elevators ?? []).map(lift=>{
    const part=next.parts.find(p=>p.id===lift.part);
    const select=document.createElement("select");
    const canPlay=elevatorClips(lift).length>0;
    if (canPlay) select.add(new Option("Animate","animate"));
    select.add(new Option("Model pose",""));
    select.add(new Option("Highlight platform","platform"));
    for (const motion of ["raise","lower"] as const) {
      const steps=lift[motion];
      steps.forEach((pose,i)=>{
        const label=i===steps.length-1 ? (motion==="raise" ? "Raised" : "Lowered") :
          (motion==="raise" ? "Raise" : "Lower")+" · step "+(i+1);
        select.add(new Option(label+" ("+pose.time+" s)",motion+"/"+i));
      });
    }
    const prior=same ? previous.get(lift.name) : undefined;
    const restored=prior?.value ?? (!same && saved?.entity===active.id ? saved.elevatorPoses?.[lift.name] : undefined);
    if ([...select.options].some(option=>option.value===restored)) select.value=restored;
    function apply(started:number) {
      const play=poseElevator(active.view,part,lift,select.value);
      liftStates.set(lift.name,{value:select.value,started,play});
      play?.(animationSeconds-started);
    }
    apply(prior?.value===select.value ? prior.started : animationSeconds);
    select.onchange=()=>{
      apply(animationSeconds);
      fitEntityShadows(sun,model);
      syncArcs();
      syncPlayback();
      changed();
    };
    const row=document.createElement("li"), label=document.createElement("label");
    label.dataset.elevator="object:"+lift.name.toLowerCase();
    label.append(lift.name,select);
    row.append(label);
    return row;
  });
  elevatorPanel.querySelector("ul").replaceChildren(...rows);
  elevatorPanel.hidden=!rows.length;
}
const settings: DisplaySettings = {
  meshes: saved?.meshes ?? true, colliders: saved?.colliders ?? true, objects:saved?.objects ?? true, arcs:saved?.arcs ?? true,
  taxiPaths:saved?.taxiPaths ?? true, airPaths:saved?.airPaths ?? false,
  meshWireframe: saved?.meshWireframe ?? saved?.wireframe ?? false, colliderWireframe: saved?.colliderWireframe ?? true
};
const hidden = new Set<string>(saved?.hidden);
const categories = new Map<string, boolean>();
let updateRows: (() => void)[] = [];
let matchFlags = meshFlagMatcher([]);
let meshTags: MeshTags = new Map();
let canEditTags = false;
let meshOrder:string[] = [], redrawOrder:() => void;
let updateFlagRows: (() => void)[] = [];
function inCategory(part: PreviewPart) {
  if (excluded.has(part.id)) return false;
  if (part.routeKind) return settings[part.routeKind];
  if (part.widget) return settings.objects || (settings.arcs && arcGuides.has(part.id));
  return part.collider ? settings.colliders : settings.meshes;
}
function updateDisplay() {
  updateRows.forEach(update => update());
  if (model) {
    applyDisplay(model, categories, excluded.size ? new Set([...hidden,...excluded]) : hidden, {...settings, missingTextureColor});
    if (sun.castShadow) renderer.shadowMap.needsUpdate = true;
    draw();
  }
}
function changed() {
  drawTraffic(0);
  syncPlayback();
  updateDisplay();
  const elevatorPoses=Object.fromEntries([...liftStates].map(([name,lift])=>[name,lift.value]));
  vscode.setState({...settings, mode, animations:animationToggle.checked, aircraft:aircraftToggle.checked, elevatorPoses, hidden: [...hidden], entity:selectedEntity, appearance:selectedAppearance, modelSources:selectedSources});
}
entitySelect.onchange = () => vscode.postMessage({type:"selectEntity",entity:entitySelect.value});
appearanceSelect.onchange = () => vscode.postMessage({type:"selectEntity",entity:entitySelect.value,appearance:appearanceSelect.value,modelSources:selectedSources});
function showModelSources(choices: ModelSourceChoice[]) {
  selectedSources = Object.fromEntries(choices.filter(c=>c.selected).map(c=>[c.key,c.selected]));
  const sources = document.querySelector<HTMLDetailsElement>("#model-sources");
  sources.hidden = !choices.length;
  sources.querySelector("ul").replaceChildren(...choices.map(choice=>{
    const item = document.createElement("li");
    if (choice.files.length === 1) {
      item.textContent = choice.key + " · " + choice.files[0].label;
    } else {
      const label = document.createElement("label");
      label.append(choice.key);
      const select = document.createElement("select");
      select.add(new Option("Auto (" + choice.files[0].label + " first)", ""));
      for (const file of choice.files) select.add(new Option(file.label,file.id));
      select.value = choice.selected;
      select.onchange = () => {
        if (select.value) selectedSources[choice.key] = select.value;
        else delete selectedSources[choice.key];
        changed();
        vscode.postMessage({type:"selectEntity",entity:selectedEntity,appearance:selectedAppearance,modelSources:selectedSources});
      };
      label.append(select);
      item.append(label);
    }
    return item;
  }));
}
for (const category of ["meshes","colliders","objects","arcs","taxiPaths","airPaths"] as const) {
  const input = document.querySelector<HTMLInputElement>("#"+category);
  input.checked = settings[category];
  input.onchange = () => { settings[category] = input.checked; changed(); };
}
for (const key of ["meshWireframe","colliderWireframe"] as const) {
  const mode = document.querySelector<HTMLSelectElement>("#"+key);
  mode.value = settings[key] ? "wireframe" : "shaded";
  mode.onchange = () => { settings[key] = mode.value === "wireframe"; changed(); };
}

function showOutline(nodes: OutlineNode[], note = "", uri?: string, preserve=false) {
  redrawOrder = () => showOutline(nodes,note,uri,true);
  const expanded=new Map(Array.from(outline.querySelectorAll<HTMLDetailsElement>("details[data-branch]"),el=>[el.dataset.branch,el.open]));
  const scroll=outline.scrollTop;
  const entityTrees = nodes.some(node=>node.tree);
  const message = outline.querySelector("p");
  message.textContent = note;
  message.hidden = !note;
  updateRows = [];
  updateFlagRows = [];
  categories.clear();
  objectLabels.clear();
  function rows(siblings:OutlineNode[], path:string, depth:number) {
    const sorted = orderedSiblings(siblings,entityTrees ? [] : meshOrder), keys = sorted.map(s => s.key);
    return sorted.map(({node,key}) => row(node,path,depth,key,keys));
  }
  function row(node: OutlineNode, path: string, depth: number, key:string, siblings:string[]): {item: HTMLLIElement; subtree: PreviewPart[]} {
    const item = document.createElement("li");
    const fullPath = path ? path + " / " + node.name : node.name;
    const label = document.createElement(node.children.length || node.tree ? "summary" : "span");
    label.title = fullPath;
    if (node.entityId) {
      inspector.link(label,node.entityId);
      objectLabels.set(node.entityId,label);
      label.addEventListener("click",event=>{
        if (!event.ctrlKey && !event.metaKey && !(event.target instanceof HTMLInputElement)) selectObject(node.entityId,false);
      });
      label.addEventListener("keydown",event=>{
        if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) selectObject(node.entityId,false);
      });
    }
    const content = document.createElement("span");
    content.className = "row";
    label.append(content);
    if (uri) item.dataset.vscodeContext = JSON.stringify({ spIniExportUri:uri, spIniFbxUri: uri, spIniModelId: node.modelId, spIniLeaf: !node.children.length });
    const children = rows(node.children,fullPath,depth + 1);
    const subtree: PreviewPart[] = [...node.parts, ...children.flatMap(child => child.subtree)];
    const targets = node.parts.length ? node.parts : subtree;
    const classify = () => {
      for (const part of node.parts) {
        if (part.names) part.collider = colliderType(meshTags, ...part.names);
        categories.set(part.id, part.collider);
      }
      if (!node.colliderStyle) content.classList.toggle("collider", !!node.parts.length && node.parts.every(part => part.collider));
    };
    classify();
    const check = document.createElement("input");
    check.type = "checkbox";
    check.setAttribute("aria-label", "Visibility of " + fullPath);
    check.title = "Show or hide " + node.name;
    check.onclick = event => event.stopPropagation();
    check.onchange = () => {
      const route=node.parts[0]?.routeKind;
      if (route && check.checked && !settings[route]) {
        for (const obj of active?.scene.objects ?? []) if (obj.route?.kind===route) hidden.add(obj.id);
        settings[route]=true;
        document.querySelector<HTMLInputElement>("#"+route).checked=true;
      }
      for (const part of targets.filter(inCategory)) {
        if (check.checked) hidden.delete(part.id);
        else hidden.add(part.id);
      }
      changed();
    };
    if (targets.length && !node.tree) content.append(check);
    if (node.colliderStyle) content.classList.add(node.colliderStyle);
    content.append(node.name || "(unnamed)");
    if (!entityTrees && canEditTags && siblings.length > 1) content.append(meshMoveButtons(node.name,key,siblings,
      direction => vscode.postMessage({type:"moveMesh",key,siblings,direction})));
    if (node.meshName || (!entityTrees && node.parts.length)) {
      const badges = document.createElement("span");
      badges.className = "mesh-flags";
      content.append(badges);
      const edit = document.createElement("button");
      if (node.tagNames) {
        edit.className = "codicon codicon-edit edit-tags";
        edit.title = "Edit mesh tags";
        edit.setAttribute("aria-label", "Edit tags for " + node.name);
        edit.onclick = event => {
          event.preventDefault(); event.stopPropagation();
          vscode.postMessage({type:"editMeshTags", names:node.tagNames, objectName:node.name});
        };
        content.append(edit);
      }
      const title = label.title;
      const update = () => {
        edit.hidden = !canEditTags;
        const flags = matchFlags(...(node.tagNames ?? [node.name, node.meshName]));
        badges.hidden = !flags.length;
        badges.replaceChildren(...flags.map(flag => {
          const icon = document.createElement("span");
          icon.className = "codicon codicon-" + flag.icon;
          icon.title = flag.label;
          icon.setAttribute("role", "img");
          icon.setAttribute("aria-label", flag.label);
          return icon;
        }));
        label.title = [title, flags.map(flag => flag.label).join(", ")].filter(Boolean).join("\n");
      };
      updateFlagRows.push(() => { classify(); update(); });
      update();
    }
    updateRows.push(() => {
      const active = targets.filter(inCategory);
      const visible = active.filter(part => !hidden.has(part.id)).length;
      check.checked = visible > 0 && visible === active.length;
      check.indeterminate = visible > 0 && visible < active.length;
      check.disabled = !active.length && !(node.parts[0]?.routeKind && !excluded.has(node.entityId));
      if (entityTrees) {
        const matches = node.entityId && !excluded.has(node.entityId);
        item.hidden = mode !== "Everything" && !matches && children.every(child=>child.item.hidden);
      } else {
        item.hidden = !subtree.some(inCategory) && !(subtree.length === 0 && settings.meshes && settings.colliders);
      }
    });
    if (node.children.length || node.tree) {
      const branch = document.createElement("details");
      branch.dataset.branch=fullPath;
      branch.open = (preserve ? expanded.get(fullPath) : undefined) ?? (depth === 0 && nodes.length === 1);
      const list = document.createElement("ul");
      list.append(...children.map(child => child.item));
      branch.append(label, list);
      item.append(branch);
    } else {
      if (uri) label.tabIndex = 0;
      item.append(label);
    }
    return {item, subtree};
  }
  outline.querySelector(":scope > ul").replaceChildren(...rows(nodes,"",0).map(row => row.item));
  if (preserve) outline.scrollTop=scroll;
  updateDisplay();
}

function draw() {
  inspector.hide();
  render();
}
function render() {
  arcValues.hidden=!arcValues.childElementCount || !settings.arcs || hidden.has(pickedObject);
  renderer.clear();
  camera.layers.set(previewLayer.mesh);
  renderDaylight(renderer,scene,camera);
  if (settings.colliders) {
    renderer.clearDepth();
    camera.layers.set(previewLayer.collider);
    renderer.render(scene,camera);
    if (bright.length) {
      camera.layers.set(previewLayer.highlight);
      const w=canvas.clientWidth,h=canvas.clientHeight;
      // A one-pixel rim stays visible even when the collider is already white.
      for (const [x,y] of [[-1,0],[1,0],[0,-1],[0,1],[0,0]]) {
        renderer.clearDepth();
        renderer.setViewport(x,y,w,h);
        renderer.render(scene,camera);
      }
    }
  }
  if (active && liftStates.size) {
    camera.layers.set(previewLayer.elevator);
    renderer.render(scene,camera);
  }
  if (active && (settings.taxiPaths || settings.airPaths)) {
    camera.layers.set(previewLayer.route);
    renderer.render(scene,camera);
  }
  if (selectedEntity && (settings.objects || settings.arcs || trafficGroup.visible)) {
    renderer.clearDepth();
    camera.layers.disableAll();
    if (settings.objects) camera.layers.enable(previewLayer.widget);
    if (trafficGroup.visible) camera.layers.enable(previewLayer.aircraft);
    if (settings.arcs) {
      camera.layers.enable(previewLayer.arc);
      for (const [id,{guides}] of arcGuides) {
        for (const {line,color} of guides) {
          line.visible=!hidden.has(id) && !excluded.has(id);
          line.material.color.setHex(color).multiplyScalar(arcGuides.has(pickedObject) && pickedObject!==id ? 0.45 : 1);
          line.renderOrder=pickedObject===id ? 13 : 12;
        }
      }
    }
    renderer.render(scene,camera);
  }
  camera.layers.set(previewLayer.mesh);
}

function frame(fitVisibleRoutes=false) {
  const extent = fitVisibleRoutes && active && settings.airPaths ? entityBounds(active.view.model,true) : bounds;
  const halfAngle = Math.atan(Math.tan(camera.fov * Math.PI / 360) * Math.min(1, camera.aspect));
  const distance = Math.max(extent.radius,0.001) * 1.1 / Math.sin(halfAngle);
  controls.target.copy(extent.center);
  camera.position.set(1, 0.65, 1).normalize().multiplyScalar(distance).add(extent.center);
  camera.near = bounds.radius / 1000;
  camera.far = Math.max(bounds.radius * 1000, distance * 2);
  controls.maxDistance = camera.far / 2;
  camera.updateProjectionMatrix();
  controls.update();
  draw();
}

function resize() {
  if (!window.innerHeight || !window.innerWidth) return;
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  draw();
}

function dispose(group, keep=new Set<unknown>()) {
  group.traverse(child => {
    if (!keep.has(child.geometry)) child.geometry?.dispose();
    if (child.material) [child.material].flat().forEach(material => {
      for (const value of Object.values(material)) if (value instanceof Texture && !keep.has(value)) value.dispose();
      material.dispose();
    });
  });
}

let revision = 0;
let streamVersion:number, stream:EntityStream, streamFramed=false, streamMoved=false, paintFrame=0;
let retained:Pick<EntityStream,"cachedGeometry"|"cachedTextures">;
function paintStream() {
  if (!paintFrame) paintFrame=requestAnimationFrame(()=>{ paintFrame=0; if (controls) render(); });
}
function clearStream() {
  stream?.dispose();
  stream=undefined;
  if (model) model.visible=true;
  streamFramed=false;
  streamMoved=false;
}
async function loadEntity(id:string, next:EntityScene, documentUri:string, incoming?:EntityStream) {
  const current=++revision, same=active?.id===id;
  let staged:ReturnType<typeof assembledEntity>;
  try {
    const manager=incoming?.display ? incoming.manager : new LoadingManager();
    const loader=new TextureLoader(manager);
    manager.onProgress=paintStream;
    manager.onLoad=()=>{if (model) { markMissingMaps(model); updateDisplay(); }};
    const patched=same && patchEntity(active.view,active.scene,next,loader);
    if (!patched) {
      const priorBuffers=new Map(active?.scene.geometry.map((g,i)=>[g,active.view.meshes[i]]));
      const priorTextures=new Map(active?.scene.textures.map((t,i)=>[t,active.view.textures[i]]));
      const buffers=incoming?.display ? incoming.buffers : next.geometry.map(g=>priorBuffers.get(g) ?? entityGeometry(g));
      const maps=incoming?.display ? incoming.maps : next.textures.map(t=>priorTextures.get(t) ?? entityTexture(loader,t));
      staged=assembledEntity(next,manager,buffers,maps);
      if (incoming?.texturesSettled) markMissingMaps(staged.model);
    }
    const view=staged || active.view;
    const extent=entityBounds(view.model);
    if (!Number.isFinite(extent.radius) || extent.isEmpty()) throw Error("No drawable geometry in this model.");
    inspector.hide();
    if (staged) {
      if (same) staged.model.position.copy(model.position);
      else staged.model.position.sub(extent.center);
      extent.center.add(staged.model.position);
      if (model) { scene.remove(model); dispose(model,new Set<unknown>([...staged.meshes,...staged.textures])); }
      model=staged.model;
      scene.add(model);
    }
    bounds.copy(extent);
    bounds.radius ||= 1;
    const oldVisibility=new Map((same ? active.scene.parts : []).map(p=>[p.id,p.visible]));
    if (!same && initializedEntity!==id) hidden.clear();
    for (const part of !active && initializedEntity===id ? [] : next.parts) {
      if (oldVisibility.has(part.id) && oldVisibility.get(part.id)!==part.visible && part.visible) hidden.delete(part.id);
      if (!part.visible && oldVisibility.get(part.id)!==false) hidden.add(part.id);
    }
    fitEntityShadows(sun,model);
    initializedEntity=id;
    active={id,scene:next,view};
    const key=JSON.stringify([id,next.flightDeck,next.elevators,next.objects?.filter(o=>o.route).map(o=>[o.id,o.route])]);
    if (key!==layoutKey) {
      layoutKey=key;
      network=next.flightDeck && new FlightNetwork(next.flightDeck,next.objects ?? [],next);
    }
    retained=incoming && {cachedGeometry:incoming.cachedGeometry,cachedTextures:incoming.cachedTextures};
    if (!same) animationSeconds = 0;
    showElevators(next,same);
    for (const kind of ["taxiPaths","airPaths"] as const)
      document.getElementById(kind+"-filter").hidden = !next.objects?.some(obj=>obj.route?.kind===kind);
    sampleSpins = bindEntitySpins(view.nodes,next.spins);
    sampleSpins?.(animationSeconds);
    syncPlayback();
    excluded=excludedOverlays(next,mode);
    if (excluded.has(pickedObject)) pickedObject=undefined;
    syncArcs();
    inspector.setParts([...next.parts,...(next.objects || [])],documentUri);
    if (staged) {
      showOutline(view.outline,"",undefined,same);
      if (!same || !objectLabels.has(pickedObject)) pickedObject=undefined;
      if (pickedObject) selectObject(pickedObject,false);
    } else {
      inspector.refreshLinks(outline);
    }
    focusTraffic();
    showArcValues();
    changed();
    if (!same && streamMoved && staged) {
      camera.position.add(staged.model.position);
      controls.target.add(staged.model.position);
      controls.update();
    } else if (!same) frame();
    canvas.setAttribute("aria-label",[id,selectedAppearance].filter(Boolean).join(" · ")+" 3D preview");
    fit.hidden=false;
    status.textContent="Drag to orbit · Scroll to zoom";
    return true;
  } catch (error) {
    if (staged && staged.model!==model) dispose(staged.model);
    if (current===revision) status.textContent=error.message;
  } finally {
    if (incoming) {
      incoming.dispose(!!staged && staged.model===model);
      stream=undefined;
      if (model) model.visible=true;
      paintStream();
    }
  }
}

async function load(data, layout?: ReturnType<typeof objLayout>) {
  const current = ++revision;
  sampleSpins = undefined;
  network=undefined; traffic=undefined; layoutKey=undefined; trafficGroup.visible=false;
  liftStates.clear();
  syncPlayback();
  if (model) { scene.remove(model); dispose(model); model = undefined; }
  try {
    let next;
    let loading = false;
    const manager = new LoadingManager();
    manager.onStart = () => { loading = true; };
    manager.onLoad = () => {
      loading = false;
      if (current === revision && next && model === next) { markMissingMaps(next); updateDisplay(); }
    };
    if (data.type === "fbx") {
      if (data.error) throw Error(data.error);
      const base = new URL(".", data.url).href;
      if (data.scene) next = previewFbx(data.scene, base, manager);
      else {
        const response = await fetch(data.url, { cache: "no-store" });
        if (!response.ok) throw Error("Could not read FBX (" + response.status + ").");
        const buffer = await response.arrayBuffer();
        if (current !== revision) return;
        try {
          next = new FBXLoader(manager).parse(buffer, base);
          if (new Box3().setFromObject(next).isEmpty()) throw Error("Empty FBX preview");
        } catch {
          if (next) dispose(next);
          vscode.postMessage({type:"fbxFallback", revision:data.revision});
          return;
        }
      }
    } else {
      next = previewObj(data.text, layout);
      if (data.url) await loadObjDiffuseMaps(next, data.url, manager);
      if (current !== revision) { dispose(next); return; }
    }
    model = next;
    if (!loading) markMissingMaps(model);
    new Box3().setFromObject(model).getBoundingSphere(bounds);
    if (!Number.isFinite(bounds.radius) || bounds.isEmpty()) throw Error("No drawable geometry in this model.");
    bounds.radius ||= 1;
    model.position.sub(bounds.center);
    bounds.center.set(0,0,0);
    scene.add(model);
    applyDisplay(model, categories, hidden, {...settings, missingTextureColor});
    frame();
    fit.hidden = false;
    status.textContent = "Drag to orbit · Scroll to zoom";
  } catch (error) {
    if (current !== revision) return;
    if (model) { scene.remove(model); dispose(model); model = undefined; }
    draw();
    fit.hidden = true;
    status.textContent = error.message;
  }
}

try {
  renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.autoClear = false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  canvas.addEventListener("contextmenu", event => {
    if (!document.body.dataset.vscodeContext) return;
    // OrbitControls consumes the canvas event. Forward it to VS Code outside the controls.
    event.preventDefault();
    event.stopImmediatePropagation();
    document.body.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY, button: event.button
    }));
  });
  controls = new OrbitControls(camera, canvas);
  controls.addEventListener("start",()=>{if (streamFramed) streamMoved=true;});
  controls.addEventListener("change", draw);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  resize();
  window.addEventListener("resize", resize);
  fit.addEventListener("click",()=>frame(true));
} catch {
  status.textContent = "The model preview needs WebGL 2. Check graphics acceleration in VS Code.";
}

let fbxUri: string;
window.addEventListener("message", ({ data }) => {
  if (data.type === "missingTextureColor" && isMissingTextureColor(data.value)) {
    textureSelect.value = missingTextureColor = data.value;
    textureSelect.title = data.project ? "Saved in project settings" : "Applies to this window. Open a folder to save a project setting.";
    updateDisplay();
    return;
  }
  if (data.type === "meshFlags") {
    meshTags = new Map(data.entries.map(([name, flags]) => [name, new Map(flags)]));
    matchFlags = meshFlagMatcher(data.rules, meshTags);
    const orderChanged = canEditTags !== data.editable || JSON.stringify(meshOrder) !== JSON.stringify(data.order ?? []);
    meshOrder = data.order ?? [];
    canEditTags = data.editable;
    const error = document.getElementById("sidecar-error");
    error.textContent = data.error;
    error.hidden = !data.error;
    if (orderChanged && redrawOrder) redrawOrder();
    else updateFlagRows.forEach(update => update());
    updateDisplay();
    return;
  }
  if (data.type === "entityLoading" || data.type === "entityError") {
    if (data.type==="entityError" && data.version!==streamVersion) return;
    streamVersion=data.version;
    clearStream();
    if (data.type==="entityLoading" && retained) vscode.postMessage({type:"entityCachedAssets",version:data.version,
      digests:[...retained.cachedGeometry.keys(),...retained.cachedTextures.keys()]});
    if (controls) paintStream();
    revision++;
    if (data.message || !model) status.textContent = data.message || "Assembling entity…";
    return;
  }
  if (data.type==="entityChunk") {
    if (data.version!==streamVersion || !controls) return;
    const chunk=data.chunk;
    if (chunk.kind==="parts") {
      const manager=new LoadingManager();
      const batch=stream=new EntityStream(chunk.parts,active?.id!==data.entity,manager);
      manager.onProgress=()=>{if (stream===batch && streamFramed) paintStream();};
    } else if (stream) {
      const visible=stream.append(chunk,settings,hidden,retained);
      if (visible && !streamFramed) {
        streamFramed=true;
        if (model) model.visible=false;
        scene.add(stream.group);
        bounds.copy(entityBounds(stream.group));
        bounds.radius ||= 1;
        frame();
      } else if (streamFramed) paintStream();
    }
    return;
  }
  if (data.type === "entityChoices") {
    outline.querySelector("summary").textContent = "Entity hierarchy";
    document.getElementById("object-filter").hidden = false;
    document.getElementById("arc-filter").hidden = false;
    selectedEntity = data.entity; selectedAppearance = data.appearance;
    for (const [select,choices,value] of [[entitySelect,data.entities,selectedEntity],[appearanceSelect,data.appearances,selectedAppearance]] as const) {
      if (choices.length!==select.length || choices.some((c,i)=>select.options[i].value!==c.id || select.options[i].text!==c.label))
        select.replaceChildren(...choices.map(c=>new Option(c.label,c.id)));
      if (select.value!==(value || "")) select.value=value || "";
    }
    showModelSources(data.modelSources ?? []);
    picker.hidden = false;
    entitySelect.disabled = data.entities.length === 1;
    const appearanceLabel = picker.querySelector<HTMLLabelElement>("#appearance-label");
    appearanceLabel.textContent = data.appearances.some(c=>/^squadron/i.test(c.id)) ? "Squadron" : "Variant";
    appearanceLabel.hidden = appearanceSelect.hidden = !data.appearances.length;
    return;
  }
  if (data.type === "entityScene") {
    if (data.version!==undefined && streamVersion!==undefined && data.version!==streamVersion) return;
    if (stream) Object.assign(data.scene,{geometry:stream.geometry,textures:stream.textures});
    const notes: string[] = data.scene.warnings;
    warnings.hidden = !notes.length;
    warnings.querySelector("summary").textContent = "Preview notes ("+notes.length+")";
    warnings.querySelector("div").replaceChildren(...notes.map(note=>{const p=document.createElement("p");p.textContent=note;return p;}));
    const report=(applied:boolean)=>vscode.postMessage({type:"entityRendered",version:data.version,applied});
    if (controls) void loadEntity(data.entity,data.scene,data.documentUri,stream).then(applied=>report(!!applied));
    else { status.textContent = "The entity preview needs WebGL 2."; report(false); }
    return;
  }
  if (data.type === "outline") {
    showOutline(data.nodes || [], data.error || (data.nodes?.length ? "" : "No model nodes in this scene."), fbxUri);
    return;
  }
  if (data.type !== "model" && data.type !== "fbx") return;
  fbxUri = data.type === "fbx" ? data.uri : undefined;
  document.body.dataset.vscodeContext = JSON.stringify({spIniExportUri:data.sourceUri, spIniFbxUri:fbxUri});
  let layout: ReturnType<typeof objLayout>;
  if (data.type === "fbx") {
    showOutline([], data.error || "Reading model hierarchy…");
  } else {
    outline.querySelector("summary").textContent = "Objects and groups";
    layout = objLayout(data.text);
    showOutline(layout.nodes);
  }
  if (controls) void load(data, layout);
});
vscode.postMessage({ type: "ready",entity:selectedEntity,appearance:selectedAppearance,modelSources:selectedSources });
