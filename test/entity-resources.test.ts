import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildCatalog } from "../src/catalog";
import { parse } from "../src/ini";
import { entityResourceSources } from "../src/entity-resources";
import { entityAssets } from "../src/entity-assets";
import { Materials } from "../src/materials";
import { MeshFiles } from "../src/meshes";

test("model choices stay inside the referenced folder and drive entity geometry", async t=>{
  const root = await mkdtemp(join(tmpdir(),"sp-ini-sources-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const text = "[Models]\nResourcesFolder=ships/a\nResourcesRoot=ship.obj\nResourcesMesh=Hull\n[Unreferenced]\nRootMesh=other";
  const doc = parse(text), uri=pathToFileURL(join(root,"unit.ini")).href;
  await mkdir(join(root,"ships","a"),{recursive:true});
  await mkdir(join(root,"ships","b"));
  const obj = "o Hull\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3";
  for (const [file,body] of [["unit.ini",text],["ships/a/ship.obj",obj],["ships/a/ship.fbx","unreadable"],["ships/a/ship.blend",""],
    ["ships/b/ship.obj",""],["ships/a/other.obj",""]]) await writeFile(join(root,file),body);
  const catalog=await buildCatalog([{dir:root,source:"Workspace"}]);
  const unavailable=join(root,"absent-blender");
  const plan=await entityResourceSources(doc,uri,catalog,{},unavailable);
  assert.deepEqual(plan.choices.map(c=>c.files.map(f=>f.label)),[["ship.fbx","ship.obj"]]);
  assert.equal(plan.choices[0].selected,"");
  const render=resources=>entityAssets(doc,uri,catalog,new MeshFiles(),new Materials(()=>undefined),undefined,{},resources,new AbortController().signal);
  assert.equal((await render(plan)).geometry.length,1);
  const selected=plan.choices[0].files[0].id;
  const override=await entityResourceSources(doc,uri,catalog,{"ships/a/ship":selected},unavailable);
  assert.equal(override.choices[0].selected,selected);
  assert.equal((await render(override)).geometry.length,0);
  await rm(join(root,"ships/a/ship.fbx"));
  const single=await entityResourceSources(doc,uri,catalog,{"ships/a/ship":selected},unavailable);
  assert.deepEqual(single.choices[0].files.map(f=>f.label),["ship.obj"]);
  assert.equal(single.choices[0].selected,"");
});
