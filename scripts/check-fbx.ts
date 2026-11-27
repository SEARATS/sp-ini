import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Box3, LoadingManager, Mesh, Vector3 } from "three";
import { ufbxRevision } from "./build-fbx";
import { readFbx } from "../src/fbx-reader";
import { previewFbx } from "../src/fbx-scene";
import { fbxGeometry } from "../src/fbx-geometry";
import { flatten, hierarchy, snippet } from "../src/hierarchy";
import { readExportGeometry } from "../src/export-rig";

async function main() {
  const dir = resolve("node_modules/.cache/fbx-tests", ufbxRevision);
  await mkdir(dir, {recursive:true});
  async function sample(name: string) {
    const file = join(dir, name + ".fbx");
    try { return await readFile(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
    const response = await fetch(`https://raw.githubusercontent.com/ufbx/ufbx/${ufbxRevision}/data/${name}.fbx`);
    if (!response.ok) throw Error(name + ": HTTP " + response.status);
    const bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(file, bytes);
    return bytes;
  }

  const cases: [string, string, number][] = [
    ["max6_teapot_3000_binary","Teapot01",240], ["max7_cube_5000_binary","Box01",12],
    ...[6100,7100,7400,7500].map(v=>[`maya_cube_big_endian_${v}_binary`,"pCube1",12] as [string,string,number])
  ];
  for (const encoding of ["ascii","binary"]) {
    for (const v of [5800,6100]) cases.push([`max2009_cube_texture_${v}_${encoding}`,"Box01",12]);
    for (const v of [6100,7100,7400,7500]) cases.push([`maya_cube_${v}_${encoding}`,"pCube1",12]);
    for (const v of [7200,7300]) cases.push([`marvelous_quad_${v}_${encoding}`,"marvelous_quad",374]);
    cases.push([`maya_blend_shape_cube_7700_${encoding}`,"pCube1",12]);
  }
  for (const [file, name, triangles] of cases) {
    const bytes = await sample(file), scene = readFbx(bytes);
    const tree = flatten(hierarchy(bytes));
    assert.ok(tree.some(n=>n.name === name && n.mesh), file + " hierarchy");
    const node = scene.nodes.find(n=>n.name === name);
    const mesh = scene.meshes[node.mesh];
    assert.equal(mesh.indices.length, triangles*3, file);
    assert.ok(mesh.indices.every(i=>i*3 < mesh.positions.length), file);
    const object = fbxGeometry(bytes).objects.find(o=>o.name === name);
    assert.equal(object.faces.reduce((sum, face)=>sum+face.indices.length-2,0), triangles, file + " lookup");
    if (file.startsWith("max2009")) {
      assert.equal(mesh.uvs.length, mesh.positions.length/3*2, file + " UVs");
      if (file.includes("6100")) assert.match(scene.materials[0].path, /tiny_clouds\.png$/);
    }
    // Exercise the same scene builder as the webview. Image decoding requires a browser.
    for (const mat of scene.materials) { mat.path = ""; mat.content = undefined; }
    const bounds = new Box3().setFromObject(previewFbx(scene, "file:///", new LoadingManager()));
    assert.ok(!bounds.isEmpty() && bounds.min.toArray().every(Number.isFinite), file + " preview");
  }
  const instanceFile = await sample("max_geometry_transform_instances_6100_binary");
  const nested = hierarchy(instanceFile)[0];
  assert.deepEqual(flatten([nested]).map(n=>n.name), ["Box001","Box002","Box003","Box004"]);
  assert.ok(Math.abs(nested.children[0].children[0].position[1]-20) < 1e-5);
  assert.match(snippet("instances.fbx",nested), /Parent=Box002\nPosition=0,20,/);
  const scene = readFbx(instanceFile), preview = previewFbx(scene,"file:///",new LoadingManager());
  preview.updateMatrixWorld(true);
  const fitted = readExportGeometry("instances.fbx",instanceFile).bounds;
  for (const node of flatten([nested]).filter(n=>n.mesh)) {
    const mesh = preview.getObjectByName(node.name).children.find(c=>c instanceof Mesh) as Mesh;
    const vertices = mesh.geometry.getAttribute("position"), indices = mesh.geometry.index;
    const points = Array.from(indices.array,i=>new Vector3().fromBufferAttribute(vertices,i).applyMatrix4(mesh.matrixWorld));
    const expected = new Box3().setFromPoints(points), fit = fitted.get(node.path);
    const center = new Vector3().fromArray(fit.center).add(new Vector3().fromArray(fit.pivot));
    center.x *= -1;
    assert.ok(center.distanceTo(expected.getCenter(new Vector3())) < 1e-4,node.path+" center");
    assert.ok(expected.getSize(new Vector3()).distanceTo(new Vector3().fromArray(fit.size)) < 1e-4,node.path+" box");
    assert.ok(points.every(p=>p.distanceTo(center) <= fit.diameter/2 + 1e-4),node.path+" sphere");
  }
  console.log(`Passed ${cases.length} FBX encoding and geometry checks plus nested hierarchy export.`);
}
main().catch(error=>{ console.error(error); process.exitCode=1; });
