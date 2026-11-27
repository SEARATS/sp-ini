import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { buildCatalog } from "../src/catalog";
import { orderedSources, roots, type SearchOptions } from "../src/roots";
import { parse } from "../src/ini";
import { Materials } from "../src/materials";
import { MeshFiles } from "../src/meshes";
import { reference, referenceContext } from "../src/references";

test("Data and Resources use independent paths and switches, including in multi-root workspaces", async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),"sp-search-"));
  t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  async function write(rel: string, text = "") {
    const full = path.join(temp,rel);
    await fs.mkdir(path.dirname(full),{recursive:true});
    await fs.writeFile(full,text);
  }
  const folders = ["one","two"].map(name=>({uri:pathToFileURL(path.join(temp,name)).href}));
  const index = async (opts: SearchOptions = {}) => buildCatalog(await roots({...opts,search:{
    game:false,workshop:false,installedMods:false,userMods:false,localMods:false,...opts.search
  }},folders));
  const unit = "[General]\nUnitType=Vessel";
  await write("one/Assets/StreamingAssets/original/vessels/base.ini",unit);
  await write("one/Assets/StreamingAssets/patch/vessels/base.ini",unit);
  await write("two/Assets/StreamingAssets/vessels/second.ini",unit);
  await write("one/vessels/work.ini",unit);
  await write("one/Assets/Resources/ships/test/test.obj","o part\nv 1 2 3");
  await write("two/Assets/Resources/ships/materials/grey.mat");
  await write("two/Assets/Resources/ships/paint.png");
  await write("two/Assets/Resources/ships/paint.png.meta","guid: aabbcc");
  await write("custom/assets/ships/materials/grey.mat");
  await write("custom/data/vessels/custom.ini",unit);
  const doc = parse("[Models]\nResourcesFolder=ships/test/\nResourcesRoot=test\n[Part]\nMesh=part\nResourcesMaterialFolder=ships/materials/\nMaterial=grey");
  const uri = folders[0].uri+"/vessels/work.ini";
  const materials = new Materials(()=>undefined);
  const material = catalog=>materials.materialFile(doc.entries.at(-1),doc,uri,catalog);
  const catalog = await index();
  assert.deepEqual(catalog.paths.get("vessels/base.ini").map(r=>path.basename(path.dirname(path.dirname(r.file.full)))),["patch","original"]);
  assert.equal(catalog.units.get("second")[0].file.source,"Data");
  assert.equal(catalog.units.get("work")[0].file.source,"Workspace");
  assert.equal(material(catalog).rel,"ships/materials/grey.mat");
  assert.equal(catalog.textureByGuid("aabbcc").rel,"ships/paint.png");
  assert.equal((await new MeshFiles().resolve(doc,uri,doc.entries[2],catalog))[0].file.source,"Resources");
  assert.equal(reference(doc.entries[1],"test",referenceContext(doc,uri,catalog)).refs[0].file.rel,"ships/test/test.obj");
  const noData = await index({search:{data:false}});
  assert.equal(noData.units.has("base"),false);
  assert.equal(material(noData).source,"Resources");
  const noResources = await index({search:{resources:false}});
  assert.equal(noResources.units.has("base"),true);
  assert.equal(material(noResources),undefined);
  assert.equal(noResources.assets.has("assets/resources/ships/test/test.obj"),false);
  const custom = await index({searchPaths:{directory:path.join(temp,"custom"),dataSubdirectory:"data",resourcesSubdirectory:"assets"},search:{projectRoot:false,mirror:false}});
  assert.deepEqual([...custom.units.keys()],["custom"]);
  assert.equal(material(custom).full,path.join(temp,"custom/assets/ships/materials/grey.mat"));
});

test("source order preserves unchecked positions and uses the first matching packed or loose asset", async () => {
  assert.deepEqual(orderedSources(["game","workshop","game","obsolete"]),[
    "game","workshop","projectRoot","data","resources","mirror","localMods","installedMods","userMods"
  ]);
  const catalog = await buildCatalog([]);
  const loose = {source:"Resources"};
  catalog.sourceRanks.set("Resources",2);
  catalog.sourceRanks.set("Vanilla",1);
  assert.equal(await catalog.withPacked(loose,async()=>"loose",async()=>"stock"),"stock");
  assert.equal(await catalog.withPacked(loose,async()=>"loose",async()=>undefined),"loose");
  catalog.sourceRanks.set("Resources",0);
  assert.equal(await catalog.withPacked(loose,async()=>"loose",async()=>"stock"),"loose");
});

test("material folder completion uses existing Resources directories or content-relative mod paths", async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),"sp-material-folders-"));
  t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const resources = {dir:path.join(temp,"CustomResources"),source:"Resources"};
  const workspace = {dir:path.join(temp,"workspace"),source:"Workspace"};
  const mod = path.join(workspace.dir,"nested-mod");
  await fs.mkdir(path.join(mod,"ships","Loose Paint"),{recursive:true});
  await fs.writeFile(path.join(mod,"_info.ini"),"[General]");
  await fs.writeFile(path.join(mod,"ship.ini"),"[Part]\nResourcesMaterialFolder=ships/packed/");
  const complete = (catalog, text: string, at=text.length) => catalog.materialFolders.complete(parse(text).entries[0],at);
  const key = "ResourcesMaterialFolder=";
  const missing = await buildCatalog([resources,workspace]);
  assert.deepEqual(complete(missing,key+"ships/").map(i=>i.label).sort(),["ships/Loose Paint/","ships/packed/"]);
  await fs.mkdir(resources.dir);
  assert.deepEqual(complete(await buildCatalog([resources,workspace]),key),[]);
  await fs.mkdir(path.join(resources.dir,"Ships","Materials","Grey"),{recursive:true});
  const catalog = await buildCatalog([workspace,resources]);
  assert.deepEqual(complete(catalog,key).map(i=>i.label),["Ships/"]);
  const text = key+"  ships\\maTT/Grey/  // keep";
  const [item] = complete(catalog,text,text.indexOf("TT"));
  assert.equal(item.label,"Ships/Materials/");
  assert.deepEqual(item.textEdit,{range:{start:{line:0,character:key.length+2},end:{line:0,character:text.indexOf("Grey")}},newText:"Ships/Materials/"});
  assert.deepEqual(complete(catalog,text),[]);
  assert.deepEqual(complete(catalog,key+"ships/Loose"),[]);
  assert.deepEqual(complete(await buildCatalog([workspace]),key+"ships/lo").map(i=>i.label),["ships/Loose Paint/"]);
});
