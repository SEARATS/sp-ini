import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import Module from "node:module";
import { hierarchy, generate, snippet, changes } from "../src/hierarchy";

test("INI and model context commands share the CLI preview and respect the clipboard destination", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(),"sp-ini-ui-"));
  try {
    const source = Buffer.from('Objects: {\n Model: 1,"Model::Hull","Null" {\n }\n Model: 2,"Model::Hull_Col","Mesh" {\n }\n Geometry: 3,"Geometry::collision","Mesh" {\n }\n}\nConnections: {\n C: "OO",2,1\n C: "OO",3,2\n}\n');
    const model = {scheme:"file",path:path.join(dir,"ship.fbx"),fsPath:path.join(dir,"ship.fbx")};
    const ini = {path:path.join(dir,"ship.ini"),fsPath:path.join(dir,"ship.ini")};
    await writeFile(model.fsPath,source);
    const before = "[Models]\nResourcesRoot=ship.fbx\n";
    await writeFile(ini.fsPath,before);
    const doc = {uri:ini,getText:()=>before,version:1,positionAt:n=>n};
    let chooser, provider, visible, copied, applied, picks;
    const commands = new Map();
    const noop = ()=>{};
    class Input { constructor(public uri) {} }
    const vscode = {
      Uri:{parse: () => model, from: value=>({...value,toString:()=>value.path+"?"+value.query})},
      TabInputCustom:Input,TabInputText:class {},Position:class {},Range:class {},
      EventEmitter:class {fire() {}}, WorkspaceEdit:class {text: string; replace(uri,range,text){this.text=text;}},
      commands:{registerCommand:(id,fn)=>commands.set(id,fn),executeCommand:()=>[{uri:model}]},
      env:{clipboard:{writeText:text=>{copied=text;}}},
      window:{activeTextEditor:{document:doc,selection:{active:{line:1}}},
        tabGroups:{activeTabGroup:{activeTab:{input:new Input(model)}},onDidChangeTabs:noop},
        createTreeView:()=>({}),showOpenDialog:()=>[ini],
        showQuickPick:(items,options)=>options.canPickMany ? items.filter(i=>i.picked && picks[0]!=="cancel") : chooser(items,picks.shift()),showTextDocument:d=>{visible=d;},
        showInformationMessage:noop,showErrorMessage:message=>assert.fail(message)},
      workspace:{registerTextDocumentContentProvider:(scheme,p)=>{provider=p;},onDidCloseTextDocument:noop,
        openTextDocument:uri=>uri===ini ? doc : provider.provideTextDocumentContent(uri),
        applyEdit:e=>{applied=e.text;return true;}}
    };
    const native = Module.prototype.require;
    let registerHierarchy;
    try {
      Module.prototype.require = function(id) {return id==="vscode" ? vscode : native.apply(this,arguments);};
      ({registerHierarchy}=require("../src/hierarchy-ui"));
    } finally {Module.prototype.require=native;}
    registerHierarchy({subscriptions:[]});
    chooser=(items,wanted)=>{
      if (wanted==="parent") return items[0];
      return items.find(i=>typeof i==="string" ? i===wanted : i.label.includes(wanted));
    };
    const root = hierarchy(source)[0];
    picks=["parent","Clipboard","Preview INI","Copy to Clipboard"];
    await commands.get("seapower-ini.generateFromIni")();
    assert.equal(copied,snippet("ship.fbx",root));
    assert.equal(visible,copied);
    assert.equal(applied,undefined);
    assert.equal(await readFile(ini.fsPath,"utf8"),before);
    for (const target of [model,{spIniFbxUri:"file:///ship.fbx"},root]) {
      copied = undefined;
      await commands.get("seapower-ini.copyHierarchy")(target);
      assert.equal(copied,snippet("ship.fbx",root));
    }
    for (const target of [model,root.children[0],{spIniFbxUri:"file:///ship.fbx",spIniModelId:"2"}]) {
      copied = undefined;
      await commands.get("seapower-ini.copyColliders")(target);
      assert.match(copied,/\[Colliders\]\nNumberOfMeshColliders=1\nMeshCollider1=Hull_Col/);
      assert.match(copied,/Collider=collision\nParent=Hull/);
      assert.doesNotMatch(copied,/\[Submodels\]/i);
    }
    picks=["cancel"];
    copied="previous";
    await commands.get("seapower-ini.copyColliders")(model);
    assert.equal(copied,"previous");
    const after=generate(before,"ship.fbx",root);
    picks=["INI file","Preview Changes",undefined];
    await commands.get("seapower-ini.generateFromModel")(root);
    assert.equal(visible,changes("ship.ini",before,after));
    assert.equal(applied,undefined);
    picks=["INI file","Preview Changes","Apply"];
    await commands.get("seapower-ini.generateFromModel")(root);
    assert.equal(applied,after);
  } finally {await rm(dir,{recursive:true,force:true});}
});
