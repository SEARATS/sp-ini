import { previewObj } from "./obj-geometry";
import { objLayout, type OutlineNode, type PreviewPart } from "./model-outline";
import { applyDisplay, type DisplaySettings } from "./preview-display";
import { Texture, Box3, DirectionalLight, HemisphereLight, LoadingManager, PerspectiveCamera, Scene, Sphere, WebGLRenderer } from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

type SavedDisplay = DisplaySettings & {hidden: string[]};
declare function acquireVsCodeApi(): { postMessage(message: unknown): void; getState(): SavedDisplay | undefined; setState(value: SavedDisplay): void };
const vscode = acquireVsCodeApi();
const status = document.querySelector("[role=status]");
const fit = document.querySelector("button");
const canvas = document.querySelector("canvas");
const outline = document.querySelector<HTMLDetailsElement>("#outline");
const scene = new Scene();
const camera = new PerspectiveCamera(42, 1, 0.01, 10000);
const bounds = new Sphere();
let renderer, controls, model;
const saved = vscode.getState();
const settings: DisplaySettings = {meshes: saved?.meshes ?? true, colliders: saved?.colliders ?? true, wireframe: saved?.wireframe ?? false};
const hidden = new Set<string>(saved?.hidden);
const categories = new Map<string, boolean>();
let updateRows: (() => void)[] = [];
const inCategory = (part: PreviewPart) => part.collider ? settings.colliders : settings.meshes;
function updateDisplay() {
  updateRows.forEach(update => update());
  if (model) { applyDisplay(model, categories, hidden, settings); draw(); }
}
function changed() {
  updateDisplay();
  vscode.setState({...settings, hidden: [...hidden]});
}
for (const category of ["meshes","colliders"] as const) {
  const input = document.querySelector<HTMLInputElement>("#"+category);
  input.checked = settings[category];
  input.onchange = () => { settings[category] = input.checked; changed(); };
}
const shading = document.querySelector<HTMLSelectElement>("#shading");
shading.value = settings.wireframe ? "wireframe" : "shaded";
shading.onchange = () => { settings.wireframe = shading.value === "wireframe"; changed(); };

function showOutline(nodes: OutlineNode[], note: string, uri?: string) {
  outline.querySelector("p").textContent = note;
  updateRows = [];
  categories.clear();
  function row(node: OutlineNode, path: string, depth: number): {item: HTMLLIElement; subtree: PreviewPart[]} {
    const item = document.createElement("li");
    const fullPath = path ? path + " / " + node.name : node.name;
    const label = document.createElement(node.children.length ? "summary" : "span");
    label.title = fullPath;
    const content = document.createElement("span");
    content.className = "row";
    label.append(content);
    if (uri) item.dataset.vscodeContext = JSON.stringify({ spIniFbxUri: uri, spIniModelId: node.modelId, spIniLeaf: !node.children.length });
    const children = node.children.map(child => row(child, fullPath, depth + 1));
    const subtree: PreviewPart[] = [...node.parts, ...children.flatMap(child => child.subtree)];
    const targets = node.parts.length ? node.parts : subtree;
    node.parts.forEach(part => categories.set(part.id, part.collider));
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
    if (targets.length) content.append(check);
    if (node.parts.length && node.parts.every(part => part.collider))
      content.append(document.querySelector<HTMLTemplateElement>("#box").content.cloneNode(true));
    content.append(node.name || "(unnamed)");
    updateRows.push(() => {
      const active = targets.filter(inCategory);
      const visible = active.filter(part => !hidden.has(part.id)).length;
      check.checked = visible > 0 && visible === active.length;
      check.indeterminate = visible > 0 && visible < active.length;
      check.disabled = !active.length;
      item.hidden = !subtree.some(inCategory) && !(subtree.length === 0 && settings.meshes && settings.colliders);
    });
    if (node.children.length) {
      const branch = document.createElement("details");
      branch.open = depth === 0 && nodes.length === 1;
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
  outline.querySelector("ul").replaceChildren(...nodes.map(node => row(node, "", 0).item));
  updateDisplay();
}

function draw() { renderer.render(scene, camera); }

function frame() {
  const halfAngle = Math.atan(Math.tan(camera.fov * Math.PI / 360) * Math.min(1, camera.aspect));
  const distance = bounds.radius * 1.1 / Math.sin(halfAngle);
  controls.target.set(0, 0, 0);
  camera.position.set(1, 0.65, 1).normalize().multiplyScalar(distance);
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
async function load(data, layout?: ReturnType<typeof objLayout>) {
  const current = ++revision;
  if (model) { scene.remove(model); dispose(model); model = undefined; }
  try {
    let next;
    if (data.type === "fbx") {
      const manager = new LoadingManager();
      manager.onLoad = () => { if (current === revision) draw(); };
      const response = await fetch(data.url, { cache: "no-store" });
      if (!response.ok) throw Error("Could not read FBX (" + response.status + ").");
      const buffer = await response.arrayBuffer();
      if (current !== revision) return;
      next = new FBXLoader(manager).parse(buffer, new URL(".", data.url).href);
    } else {
      next = previewObj(data.text, layout);
    }
    model = next;
    new Box3().setFromObject(model).getBoundingSphere(bounds);
    if (!Number.isFinite(bounds.radius) || bounds.isEmpty()) throw Error("No drawable geometry in this model.");
    bounds.radius ||= 1;
    model.position.sub(bounds.center);
    scene.add(model);
    applyDisplay(model, categories, hidden, settings);
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
  const light = new DirectionalLight(0xffffff, 2);
  light.position.set(1, 2, 3);
  scene.add(light, new HemisphereLight(0xffffff, 0x999999, 2));
  resize();
  window.addEventListener("resize", resize);
  fit.addEventListener("click", frame);
} catch {
  status.textContent = "The model preview needs WebGL 2. Check graphics acceleration in VS Code.";
}

let fbxUri: string;
window.addEventListener("message", ({ data }) => {
  if (data.type === "outline") {
    showOutline(data.nodes || [], data.error || (data.nodes?.length ? "" : "No model nodes in this FBX."), fbxUri);
    return;
  }
  if (data.type !== "model" && data.type !== "fbx") return;
  fbxUri = data.type === "fbx" ? data.uri : undefined;
  let layout: ReturnType<typeof objLayout>;
  if (fbxUri) {
    document.body.dataset.vscodeContext = JSON.stringify({spIniFbxUri: fbxUri});
    showOutline([], "Reading FBX hierarchy…");
  } else {
    delete document.body.dataset.vscodeContext;
    outline.querySelector("summary").textContent = "Objects and groups";
    layout = objLayout(data.text);
    showOutline(layout.nodes, "OBJ records group membership only.");
  }
  if (controls) void load(data, layout);
});
vscode.postMessage({ type: "ready" });
