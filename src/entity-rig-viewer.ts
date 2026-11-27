import { Box3, BufferGeometry, DirectionalLight, Float32BufferAttribute, Group, HemisphereLight, LineBasicMaterial,
  LineSegments, LoadingManager, Mesh, PerspectiveCamera, Points, PointsMaterial, Scene, Sphere, Vector3, WebGLRenderer } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { exportRigScene } from "./entity-model";
import { assembledEntity, entityGeometry } from "./entity-viewer";
import { applyDisplay, previewLayer } from "./preview-display";
import type { RigAssets } from "./export-rig";

/** Compact INI viewer for the live export. Geometry stays resident across role changes. */
export function createRigViewer(canvas: HTMLCanvasElement, assets: RigAssets) {
  const renderer = new WebGLRenderer({canvas, antialias:true, alpha:true});
  renderer.autoClear = false;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  const camera = new PerspectiveCamera(40, 1, 0.01, 10000);
  const controls = new OrbitControls(camera, canvas);
  const scene = new Scene(), guides = new Scene();
  const light = new DirectionalLight(0xffffff, 2);
  light.position.set(1, 2, 3);
  scene.add(light, new HemisphereLight(0xffffff, 0x999999, 2));
  const names = new Map(assets.names), geometry = assets.geometry.map(entityGeometry);
  const shared = new Set(geometry), manager = new LoadingManager(), bounds = new Sphere();
  let model: Group, framed = false, links = true;

  function draw() {
    if (!canvas.clientWidth || !canvas.clientHeight) return;
    renderer.clear();
    camera.layers.set(previewLayer.mesh);
    renderer.render(scene, camera);
    renderer.clearDepth();
    camera.layers.set(previewLayer.collider);
    renderer.render(scene, camera);
    camera.layers.set(previewLayer.mesh);
    if (links) { renderer.clearDepth(); renderer.render(guides, camera); }
  }
  function fit() {
    if (bounds.isEmpty()) return;
    const angle = Math.atan(Math.tan(camera.fov * Math.PI / 360) * Math.min(1, camera.aspect));
    const distance = Math.max(bounds.radius, 0.01) * 1.1 / Math.sin(angle);
    controls.target.copy(bounds.center);
    camera.position.set(1,0.65,1).normalize().multiplyScalar(distance).add(bounds.center);
    camera.near = distance / 10000; camera.far = distance * 1000;
    camera.updateProjectionMatrix();
    controls.update();
    draw();
    framed = true;
  }
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w,h,false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (!framed && !bounds.isEmpty()) fit(); else draw();
  }
  function clear() {
    for (const group of [model, guides]) group?.traverse(object => {
      if (!(object instanceof Mesh || object instanceof LineSegments || object instanceof Points)) return;
      if (!shared.has(object.geometry)) object.geometry.dispose();
      for (const material of [object.material].flat()) material.dispose();
    });
    if (model) scene.remove(model);
    model = undefined;
    guides.clear();
    bounds.makeEmpty();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  controls.addEventListener("change",draw);
  resize();
  return {
    fit,
    showLinks(value: boolean) { links = value; draw(); },
    update(ini: string) {
      clear();
      if (!ini) { draw(); return ""; }
      const rig = exportRigScene(ini, names);
      const view = assembledEntity(rig, manager, geometry);
      model = view.model;
      scene.add(model);
      applyDisplay(model, new Map(rig.parts.map(p => [p.id,p.collider])), new Set(),
        {meshes:true,colliders:true,meshWireframe:false,colliderWireframe:true});
      const pivots: number[] = [], segments: number[] = [], box = new Box3().setFromObject(model);
      const point = new Vector3(), parent = new Vector3();
      for (const part of rig.parts) {
        view.nodes.get(part.id).getWorldPosition(point);
        box.expandByPoint(point);
        pivots.push(point.x, point.y, point.z);
        if (part.parent) {
          view.nodes.get(part.parent).getWorldPosition(parent);
          segments.push(parent.x, parent.y, parent.z, point.x, point.y, point.z);
        }
      }
      const positions = (values: number[]) => new BufferGeometry().setAttribute("position",new Float32BufferAttribute(values,3));
      guides.add(new LineSegments(positions(segments), new LineBasicMaterial({color:0x59c5ff})),
        new Points(positions(pivots), new PointsMaterial({color:0xffda80,size:5,sizeAttenuation:false})));
      box.getBoundingSphere(bounds);
      if (!framed) resize(); else draw();
      return rig.warnings.join("\n");
    },
    dispose() {
      observer.disconnect(); controls.dispose(); clear();
      geometry.forEach(mesh => mesh.dispose());
      renderer.dispose();
    }
  };
}
