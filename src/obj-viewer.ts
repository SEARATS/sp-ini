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
import { assembledEntity, patchEntity } from "./entity-viewer";
import type { EntityScene } from "./entity-model";
import { entityModes, excludedOverlays, type EntityMode } from "./entity-mode";
import { previewColors } from "./preview-colors";
import { inspectEntity } from "./entity-inspect";
import {placeSystemArcs,systemArcs} from "./system-arcs";
import { Texture, Box3, Color, LoadingManager, PerspectiveCamera, Scene, Sphere, WebGLRenderer } from "three";
import { previewDaylight, fitEntityShadows, renderDaylight } from "./preview-lighting";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

type SavedDisplay = Partial<DisplaySettings> & {mode?: EntityMode; hidden?: string[]; wireframe?: boolean; entity?: string; appearance?: string; modelSources?:Record<string,string>};
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
let active: {id:string; scene:EntityScene; view:ReturnType<typeof assembledEntity>};
let bright:string[] = [], pickedObject:string;
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
  for (const [label,value,color] of [["FiringArcs",obj.firingArcs,"#ffdf72"],["ElevationArc",obj.elevationArc,"#71dfff"]]) {
    if (!value) continue;
    const span=document.createElement("span");
    span.style.color=color; span.textContent=label+"="+value; arcValues.append(span,"  ");
  }
}
const white=new Color(0xffffff);
function highlight(ids:string[]) {
  const next=ids.filter(id=>active?.view.surfaces.get(id)?.layers.isEnabled(previewLayer.collider));
  if (next.length===bright.length && next.every((id,i)=>id===bright[i])) return;
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
const inspector = inspectEntity(canvas,camera,()=>model,ids=>vscode.postMessage({type:"openEntityPart",ids}),id=>selectObject(id,true),highlight,
  id=>!excluded.has(id));
function selectObject(id: string | undefined, reveal: boolean) {
  const selected = objectLabels.get(id);
  if (id && !selected) return;
  pickedObject=id;
  showArcValues();
  for (const label of objectLabels.values()) label.classList.toggle("selected-object",label === selected);
  if (reveal && selected) {
    for (let el: HTMLElement = selected; el; el=el.parentElement) if (el instanceof HTMLDetailsElement) el.open=true;
    selected.scrollIntoView({block:"nearest"});
  }
  model?.traverse(node=>{
    if (!node.userData.widget) return;
    const active = node.userData.partId === id;
    node.material.color.set(active ? 0xffff77 : node.userData.color);
    node.renderOrder = active ? 11 : 10;
  });
  if (renderer) draw();
}
const saved = vscode.getState();
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
const settings: DisplaySettings = {
  meshes: saved?.meshes ?? true, colliders: saved?.colliders ?? true, objects:saved?.objects ?? true, arcs:saved?.arcs ?? true,
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
  updateDisplay();
  vscode.setState({...settings, mode, hidden: [...hidden], entity:selectedEntity, appearance:selectedAppearance, modelSources:selectedSources});
}
entitySelect.onchange = () => vscode.postMessage({type:"selectEntity",entity:entitySelect.value});
appearanceSelect.onchange = () => vscode.postMessage({type:"selectEntity",entity:entitySelect.value,appearance:appearanceSelect.value,modelSources:selectedSources});
function showModelSources(choices: ModelSourceChoice[]) {
  selectedSources = Object.fromEntries(choices.filter(c=>c.selected).map(c=>[c.key,c.selected]));
  document.getElementById("model-sources").replaceChildren(...choices.map(choice=>{
    const label = document.createElement("label");
    label.append(choices.length === 1 ? "Model source" : "Model source · " + choice.key);
    label.title = choice.key;
    if (choice.files.length === 1) {
      const value = document.createElement("span");
      value.textContent = choice.files[0].label;
      label.append(value);
    } else {
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
    }
    return label;
  }));
}
for (const category of ["meshes","colliders","objects","arcs"] as const) {
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
    if (node.entityId) inspector.link(label,node.entityId);
    if (node.entityId?.startsWith("object:")) {
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
      check.disabled = !active.length;
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
  outline.querySelector("ul").replaceChildren(...rows(nodes,"",0).map(row => row.item));
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
  if (selectedEntity && (settings.objects || settings.arcs)) {
    renderer.clearDepth();
    camera.layers.disableAll();
    if (settings.objects) camera.layers.enable(previewLayer.widget);
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

function frame() {
  const halfAngle = Math.atan(Math.tan(camera.fov * Math.PI / 360) * Math.min(1, camera.aspect));
  const distance = bounds.radius * 1.1 / Math.sin(halfAngle);
  controls.target.copy(bounds.center);
  camera.position.set(1, 0.65, 1).normalize().multiplyScalar(distance).add(bounds.center);
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

function dispose(group) {
  group.traverse(child => {
    child.geometry?.dispose();
    if (child.material) [child.material].flat().forEach(material => {
      for (const value of Object.values(material)) if (value instanceof Texture) value.dispose();
      material.dispose();
    });
  });
}

let revision = 0;
async function loadEntity(id:string, next:EntityScene, documentUri:string) {
  const current=++revision, same=active?.id===id;
  let staged:ReturnType<typeof assembledEntity>;
  try {
    const patched=same && patchEntity(active.view,active.scene,next);
    if (!patched) {
      const manager=new LoadingManager();
      const loaded=new Promise<void>(resolve=>{manager.onLoad=resolve;});
      staged=assembledEntity(next,manager);
      if (next.textures.length) await loaded;
      if (current!==revision) { dispose(staged.model); return; }
      markMissingMaps(staged.model);
    }
    const view=staged || active.view;
    const extent=new Box3().setFromObject(view.model).getBoundingSphere(new Sphere());
    if (!Number.isFinite(extent.radius) || extent.isEmpty()) throw Error("No drawable geometry in this model.");
    inspector.hide();
    if (staged) {
      if (same) staged.model.position.copy(model.position);
      else staged.model.position.sub(extent.center);
      extent.center.add(staged.model.position);
      if (model) { scene.remove(model); dispose(model); }
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
    excluded=excludedOverlays(next,mode);
    if (excluded.has(pickedObject)) pickedObject=undefined;
    syncArcs();
    inspector.setParts([...next.parts,...(next.objects || [])],documentUri);
    if (staged) {
      if (!same || !next.objects?.some(obj=>obj.id===pickedObject)) pickedObject=undefined;
      showOutline(view.outline,"",undefined,same);
      if (pickedObject) selectObject(pickedObject,false);
    } else {
      inspector.refreshLinks(outline);
    }
    showArcValues();
    changed();
    if (!same) frame();
    canvas.setAttribute("aria-label",[id,selectedAppearance].filter(Boolean).join(" · ")+" 3D preview");
    fit.hidden=false;
    status.textContent="Drag to orbit · Scroll to zoom";
    return true;
  } catch (error) {
    if (staged && staged.model!==model) dispose(staged.model);
    if (current===revision) status.textContent=error.message;
  }
}

async function load(data, layout?: ReturnType<typeof objLayout>) {
  const current = ++revision;
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
  controls.addEventListener("change", draw);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  resize();
  window.addEventListener("resize", resize);
  fit.addEventListener("click", frame);
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
    revision++;
    if (data.message || !model) status.textContent = data.message || "Assembling entity…";
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
    picker.querySelector("#appearance-label").textContent = data.appearances.some(c=>/^squadron/i.test(c.id)) ? "Squadron" : "Variant";
    appearanceSelect.parentElement.parentElement.hidden = !data.appearances.length;
    return;
  }
  if (data.type === "entityScene") {
    const notes: string[] = data.scene.warnings;
    warnings.hidden = !notes.length;
    warnings.querySelector("summary").textContent = "Preview notes ("+notes.length+")";
    warnings.querySelector("div").replaceChildren(...notes.map(note=>{const p=document.createElement("p");p.textContent=note;return p;}));
    const report=(applied:boolean)=>vscode.postMessage({type:"entityRendered",version:data.version,applied});
    if (controls) void loadEntity(data.entity,data.scene,data.documentUri).then(applied=>report(!!applied));
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
