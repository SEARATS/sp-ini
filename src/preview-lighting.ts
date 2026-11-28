import { ACESFilmicToneMapping, Box3, Camera, DirectionalLight, HemisphereLight, NoToneMapping, Object3D, Scene, Sphere, Vector3, WebGLRenderer } from "three";

export function previewDaylight(scene:Scene) {
  const sun = new DirectionalLight(0xffe9e6,3.6);
  const sky = new HemisphereLight(0xe5efff,0xa99790,1.55);
  const direction = new Vector3(-2,3,1.5).normalize();
  sun.position.copy(direction);
  sun.layers.enableAll();
  sky.layers.enableAll();
  scene.add(sun,sun.target,sky);
  return sun;
}

/** Tone-map the shaded pass while keeping diagnostic overlay colors literal. */
export function renderDaylight(renderer:WebGLRenderer,scene:Scene,camera:Camera) {
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 2.4;
  renderer.render(scene,camera);
  renderer.toneMapping = NoToneMapping;
}

export function fitEntityShadows(sun:DirectionalLight,model:Object3D) {
  const box = new Box3();
  model.updateMatrixWorld(true);
  model.traverse(node=>{
    if (node.receiveShadow) box.expandByObject(node);
  });
  sun.castShadow = !box.isEmpty();
  if (!sun.castShadow) return;
  const {center,radius} = box.getBoundingSphere(new Sphere());
  const span = Math.max(radius * 1.05,0.001);
  const direction = sun.position.clone().sub(sun.target.position).normalize();
  sun.target.position.copy(center);
  sun.position.copy(center).addScaledVector(direction,span*2);
  sun.shadow.mapSize.set(2048,2048);
  sun.shadow.normalBias = span * 0.0005;
  Object.assign(sun.shadow.camera,{left:-span,right:span,top:span,bottom:-span,near:span*0.5,far:span*3.5});
  sun.shadow.camera.updateProjectionMatrix();
}
