import { Box3, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, Sphere, WebGLRenderer } from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const vscode = acquireVsCodeApi();
const status = document.querySelector("[role=status]");
const fit = document.querySelector("button");
const canvas = document.querySelector("canvas");
const scene = new Scene();
const camera = new PerspectiveCamera(42, 1, 0.01, 10000);
const bounds = new Sphere();
let renderer, controls, model;

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

function clearModel() {
  if (!model) return;
  scene.remove(model);
  model.traverse(child => {
    child.geometry?.dispose();
    if (child.material) [child.material].flat().forEach(material => material.dispose());
  });
  model = undefined;
}

function load(text) {
  try {
    clearModel();
    model = new OBJLoader().parse(text);
    new Box3().setFromObject(model).getBoundingSphere(bounds);
    if (!Number.isFinite(bounds.radius) || bounds.isEmpty()) throw Error("No drawable geometry in this OBJ.");
    bounds.radius ||= 1;
    model.position.sub(bounds.center);
    scene.add(model);
    frame();
    fit.hidden = false;
    status.textContent = "Drag to orbit · Scroll to zoom";
  } catch (error) {
    clearModel();
    draw();
    fit.hidden = true;
    status.textContent = error.message;
  }
}

try {
  renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  controls = new OrbitControls(camera, canvas);
  controls.addEventListener("change", draw);
  const light = new DirectionalLight(0xffffff, 2);
  light.position.set(1, 2, 3);
  scene.add(light, new HemisphereLight(0xffffff, 0x999999, 2));
  resize();
  window.addEventListener("resize", resize);
  fit.addEventListener("click", frame);
  window.addEventListener("message", ({ data }) => { if (data.type === "model") load(data.text); });
  vscode.postMessage({ type: "ready" });
} catch {
  status.textContent = "The OBJ preview needs WebGL 2. Check graphics acceleration in VS Code.";
}
