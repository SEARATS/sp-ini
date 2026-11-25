// Run with VS Code --extensionTestsPath against an installed game or exported workspace.
import * as vscode from "vscode";
import assert from "node:assert/strict";
import * as fs from "node:fs";
async function renderedModel(port: number) {
  const seen = new Set<string>();
  for (let attempt=0; attempt<40; attempt++) {
    const targets = await (await fetch("http://127.0.0.1:"+port+"/json/list")).json();
    for (const target of targets.filter(t=>t.type==="iframe" || t.type==="page")) {
      const statuses = await new Promise<string[]>(resolve=>{
        const ws = new WebSocket(target.webSocketDebuggerUrl), contexts = new Set<number>(), values: string[] = [];
        const timer = setTimeout(finish,1200);
        function finish() { clearTimeout(timer); ws.close(); resolve(values); }
        ws.onerror=finish;
        ws.onopen=()=>ws.send(JSON.stringify({id:1,method:"Runtime.enable"}));
        ws.onmessage=event=>{
          const msg=JSON.parse(String(event.data));
          if (msg.method==="Runtime.executionContextCreated") contexts.add(msg.params.context.id);
          if (msg.id===1) {
            if (!contexts.size) return finish();
            for (const id of contexts) ws.send(JSON.stringify({id:id+2,method:"Runtime.evaluate",params:{contextId:id,
              returnByValue:true,expression:'Array.from(document.querySelectorAll("canvas")).some(c=>c.getAttribute("aria-label")==="3D model") ? document.querySelector("[role=status]").textContent : location.protocol'}}));
          } else if (msg.id>1) {
            values.push(msg.result?.result?.value || "empty");
            if (values.length>=contexts.size) finish();
          }
        };
      });
      statuses.forEach(status=>seen.add(target.type+" "+status));
      if (statuses.some(status=>status.includes("Drag to orbit"))) return;
    }
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.fail("FBX webview did not finish drawing its model: "+[...seen].join(", "));
}

export const run = async () => {
  const ini = vscode.Uri.file(process.env.SP_INI_STOCK_INI);
  const doc = await vscode.workspace.openTextDocument(ini);
  await vscode.window.showTextDocument(doc);
  await vscode.languages.setTextDocumentLanguage(doc,"seapower-ini");
  await vscode.extensions.getExtension("searats.seapower-ini").activate();
  const lines = doc.getText().split(/\r?\n/);
  const deck = lines.indexOf("[Deck]");
  assert.ok(deck>=0);
  const outcomes = [];
  for (const [key,labels] of [["Mesh",["303 faces","Wireframe","Textured"]],["Material",["Lit material","MainTex","SpecTex","BumpMap"]]] as const) {
    const line = lines.findIndex((s,i)=>i>deck && s.startsWith(key+"="));
    const pos = new vscode.Position(line,key.length+2);
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider",ini,pos);
    const hover = hovers.flatMap(h=>h.contents.map(c=>typeof c === "string" ? c : c.value)).join(" ");
    labels.forEach(label=>assert.ok(hover.includes(label),"Missing "+label+" in "+hover.slice(0,110)));
    assert.ok(hover.includes("data:image/"));
    outcomes.push(key+" hover: "+labels.join(", "));
    if (process.env.SP_INI_MIRROR==="1") {
      const refs = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>("vscode.executeDefinitionProvider",ini,pos);
      const target = refs.map(r=>"uri" in r ? r.uri : r.targetUri).find(u=>u.path.endsWith(key==="Mesh"?".fbx":".mat"));
      assert.ok(target,"Missing "+key+" definition");
      outcomes.push(key+" definition: "+target.path);
      if (key==="Mesh") {
        await vscode.commands.executeCommand("vscode.openWith",target,"seapower-ini.fbx");
        assert.ok(vscode.window.tabGroups.all.some(g=>g.tabs.some(t=>(t.input instanceof vscode.TabInputCustom && t.input.viewType)==="seapower-ini.fbx")));
        outcomes.push("FBX preview opened");
        if (process.env.SP_INI_CDP_PORT) {
          await renderedModel(Number(process.env.SP_INI_CDP_PORT));
          outcomes.push("FBX WebGL model rendered");
        }
      }
    }
  }
  fs.writeFileSync(process.env.SP_INI_TEST_RESULT,outcomes.join("\n"));
};
