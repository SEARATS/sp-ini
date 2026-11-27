import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import { buildCatalog } from "../src/catalog";
import { unityMaterial } from "../src/unity-material";
import { Materials } from "../src/materials";
import { parse } from "../src/ini";

test("Unity materials resolve sidecar GUIDs in the owning project and share the INI preview", async t => {
  const root = await mkdtemp(join(tmpdir(),"sp-ini-guid-"));
  t.after(() => rm(root,{recursive:true,force:true}));
  async function write(rel:string, value:string|Buffer) {
    const full = join(root,rel);
    await mkdir(dirname(full),{recursive:true});
    await writeFile(full,value);
    return full;
  }
  const guid = "0a234567890123456789012345678901";
  const source = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!21 &2100000
Material:
  m_SavedProperties:
    m_TexEnvs:
    - _BaseMap:
        m_Texture: {type: 3, guid: ${guid.toUpperCase()}, fileID: 2800000}
    - _MainTex:
        m_Texture: {fileID: 0}
    - _Detail:
        m_Texture: {fileID: 2800000, guid: deadbeef}
    m_Floats:
    - _Smoothness: 0.75
    m_Colors:
    - _BaseColor: {r: 1, g: 0, b: 0, a: 1}
--- !u!114 &1
MonoBehaviour: {}
`;
  for (const project of ["first","second"]) {
    const png = new PNG({width:1,height:1});
    png.data.set(project === "first" ? [0,0,0,255] : [200,150,150,255]);
    await write(project+"/Assets/Art/renamed.png", PNG.sync.write(png));
    await write(project+"/Assets/Art/renamed.png.meta","fileFormatVersion: 2\nguid: "+guid+"\n");
  }
  const full = await write("second/Assets/Materials/paint.mat",source);
  const vehicle = await write("second/Assets/Materials/unit.ini","[Part]\nMaterial=paint");
  await write("second/Assets/Materials/paint_ini.ini","[Textures]\n_MainTex=../Art/renamed.png");
  const catalog = await buildCatalog(["first","second"].map(name=>({dir:join(root,name),source:"Workspace"})));
  const reader = new Materials(()=>undefined), uri=pathToFileURL(vehicle).href;
  for (const ref of ["paint","paint.mat","paint_ini.ini"]) {
    const doc = parse("[Part]\nMaterial="+ref);
    const file = reader.materialFile(doc.entries[0],doc,uri,catalog);
    const model = await reader.preview(file,catalog);
    assert.ok(model.lit);
    assert.ok(model.maps[0].image);
    if (ref === "paint_ini.ini") continue;
    assert.equal(file.full,full);
    assert.deepEqual([...((await reader.diffuse(file,catalog)).data)], [200,150,150,255]);
    assert.deepEqual(model.maps.map(m=>m.slot),["_BaseMap","_Detail"]);
    assert.equal(model.maps[1].status,"File missing");
    assert.match((await reader.hover(file,catalog)).contents.value,/!\[Lit material\]/);
  }
  const colorOnly = source.replace(/    m_TexEnvs:[\s\S]*?(?=    m_Floats:)/,"");
  const parsed = unityMaterial(colorOnly);
  assert.equal(parsed.doc.entries.find(k=>k.name==="_BaseColor").value,"{*}ff0000ff");
  assert.ok(reader.tiles("solid",parsed.doc,[],new Map()).lit);
  const tga = Buffer.alloc(21);
  tga[2] = 2;
  tga.writeUInt16LE(1,12);
  tga.writeUInt16LE(1,14);
  tga[16] = 24;
  tga.set([87,65,43],18);
  const tgaPath = await write("second/Assets/Art/swatch.tga",tga);
  const image = await reader.texture({uri:pathToFileURL(tgaPath).href,full:tgaPath,rel:"swatch.tga"});
  assert.deepEqual([...image.data],[43,65,87,255]);
  assert.equal(unityMaterial("not a text-serialized material"),undefined);
});
