// Run with VS Code --extensionTestsPath against an installed game or exported workspace.
import * as vscode from "vscode";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { renderedModel } from "../scripts/gallery/webview";
function checkPreviewControls() {
  const canvas = document.querySelector("canvas[aria-label]") as HTMLCanvasElement;
  if (!canvas || !document.querySelector("[role=status]")?.textContent.includes("Drag to orbit")) return "loading";
  const label = document.querySelector<HTMLElement>("#outline li .row.collider");
  if (!label) return "waiting for colliders";
  const row = label.closest("li"), part = label.querySelector("input");
  const meshes = document.querySelector<HTMLInputElement>("#meshes");
  const colliders = document.querySelector<HTMLInputElement>("#colliders");
  const meshMode = document.querySelector<HTMLSelectElement>("#meshWireframe");
  const colliderMode = document.querySelector<HTMLSelectElement>("#colliderWireframe");
  if (meshMode.value !== "shaded" || colliderMode.value !== "wireframe") return "incorrect default modes";
  function render(select: HTMLSelectElement, mode: string) {
    select.value = mode;
    select.dispatchEvent(new Event("change"));
    return canvas.toDataURL();
  }
  part.click();
  colliders.click();
  const filtered = row.hidden;
  colliders.click();
  const remembered = !part.checked;
  part.click();
  meshes.click();
  const onlyColliders = canvas.toDataURL();
  const sameColliders = render(meshMode, "wireframe");
  const solidColliders = render(colliderMode, "shaded");
  colliders.click();
  const empty = canvas.toDataURL();
  meshes.click();
  const wireMesh = canvas.toDataURL();
  const sameMesh = render(colliderMode, "wireframe");
  const shadedMesh = render(meshMode, "shaded");
  colliders.click();
  const independentModes = onlyColliders === sameColliders && onlyColliders !== solidColliders && wireMesh === sameMesh && wireMesh !== shadedMesh;
  return filtered && remembered && !row.hidden && onlyColliders !== empty && independentModes ? "verified controls" : "display check failed";
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
  const folderLine = lines.findIndex(l=>/^ResourcesMaterialFolder=ships\/materials\//i.test(l));
  assert.ok(folderLine>=0);
  const folders = await vscode.commands.executeCommand<vscode.CompletionList>("vscode.executeCompletionItemProvider",
    ini,new vscode.Position(folderLine,"ResourcesMaterialFolder=ships/ma".length));
  assert.ok(folders.items.some(i=>String(i.label).toLowerCase()==="ships/materials/" && i.kind===vscode.CompletionItemKind.Folder));
  outcomes.push("Completed ships/materials/ in the Spruance INI");
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
          await renderedModel(Number(process.env.SP_INI_CDP_PORT),checkPreviewControls);
          outcomes.push("FBX collider row colors, visibility, category filters and wireframe verified");
        }
      }
    }
  }
  if (process.env.SP_INI_CDP_PORT) {
    const port = Number(process.env.SP_INI_CDP_PORT);
    await vscode.commands.executeCommand("vscode.open",ini);
    assert.equal(vscode.window.activeTextEditor?.document.uri.toString(),ini.toString());
    await vscode.commands.executeCommand("seapower-ini.previewEntity",ini);
    await renderedModel(port,()=>{
      const tree = document.querySelector("#outline > ul");
      if (document.querySelector("#entity-pickers:not([hidden])") && tree?.textContent.includes("MK45_Turret_1") &&
          tree.textContent.includes("VLS_Module_Fwd_L_1") && document.querySelector("#appearance option[value=Variant2]") &&
          tree.querySelectorAll("input").length > 35 && document.querySelector("[role=status]")?.textContent.includes("Drag to orbit")) return "verified controls";
      return document.querySelector("[role=status]")?.textContent || "waiting";
    });
    outcomes.push("Assembled Spruance with nested and repeated submodels and variant selector");
    await renderedModel(port,()=>{
      const roots = Array.from(document.querySelectorAll("#outline > ul > li > details > summary")).map(el=>el.textContent);
      const row = Array.from(document.querySelectorAll<HTMLElement>("#outline [title]")).find(el=>el.title.startsWith("[SensorSystem2]\nSPS-40\nMount=SPS_40"));
      if (roots.join("/")!=="Meshes/Colliders/Objects" || !row) return "waiting for sensor tree";
      const checkbox = row.querySelector("input"), objects = document.querySelector<HTMLInputElement>("#objects");
      if (!checkbox?.checked) return "missing sensor marker";
      objects.click();
      const off = checkbox.disabled;
      objects.click();
      row.click();
      if (!off || checkbox.disabled || !row.classList.contains("selected-object")) return "marker controls failed";
      row.dispatchEvent(new MouseEvent("click",{ctrlKey:true,bubbles:true,cancelable:true}));
      return "verified controls";
    });
    await selectedSection(/^\[SensorSystem2\]$/i);
    await renderedModel(port,async()=>{
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label*="spruance"]');
      const meshes = document.querySelector<HTMLInputElement>("#meshes"), colliders = document.querySelector<HTMLInputElement>("#colliders");
      if (!canvas || !meshes || !colliders) return "waiting for Spruance";
      if (colliders.checked) colliders.click();
      if (meshes.checked) meshes.click();
      const sample = document.createElement("canvas");
      sample.width=canvas.clientWidth; sample.height=canvas.clientHeight;
      const ctx = sample.getContext("2d");
      document.querySelector("#meshWireframe").dispatchEvent(new Event("change"));
      ctx.drawImage(canvas,0,0,sample.width,sample.height);
      const pixels = ctx.getImageData(0,0,sample.width,sample.height).data;
      const tip = document.querySelector<HTMLElement>("#part-tip");
      let candidates=0, lastHit="";
      const rect=canvas.getBoundingClientRect();
      for (let y=0;y<sample.height;y++) for (let x=0;x<sample.width;x++) {
        const i=4*(y*sample.width+x);
        if (pixels[i+3]<240 || pixels[i+2]<180 || pixels[i+2]-pixels[i]<80) continue;
        candidates++;
        const pos={clientX:rect.left+x+0.5,clientY:rect.top+y+0.5,bubbles:true};
        canvas.dispatchEvent(new PointerEvent("pointermove",pos));
        await new Promise(requestAnimationFrame);
        if (!tip.hidden) lastHit=tip.textContent.split("\n")[0];
        if (tip.hidden || !tip.textContent.startsWith("[SensorSystem")) continue;
        const header=tip.textContent.split("\n")[0];
        canvas.dispatchEvent(new PointerEvent("pointerdown",pos));
        canvas.dispatchEvent(new PointerEvent("pointerup",pos));
        canvas.dispatchEvent(new MouseEvent("click",pos));
        const selected = document.querySelector<HTMLElement>("#outline .selected-object");
        if (selected?.title.startsWith(header+"\n")) return "verified controls";
      }
      return "Marker samples: "+candidates+"; last hover: "+lastHit+"; selected: "+document.querySelector(".selected-object")?.textContent;
    });
    outcomes.push("Verified the three INI trees, marker visibility, viewport picking and sensor source navigation");
    await renderedModel(port,()=>{
      const row=[...document.querySelectorAll<HTMLElement>("#outline [title]")].find(e=>e.title.startsWith("[VLS_Module_Fwd_L_1]\nMesh="));
      if (!row || !row.title.includes("click to open INI")) return "waiting for mesh tooltip";
      row.dispatchEvent(new MouseEvent("click",{ctrlKey:true,bubbles:true,cancelable:true}));
      return "verified controls";
    });
    async function selectedSection(expected: RegExp) {
      for (let i=0;i<60;i++) {
        const editor=vscode.window.activeTextEditor;
        if (editor?.document.uri.toString()===ini.toString() && expected.test(editor.document.getText(editor.selection))) return;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      assert.fail("Did not navigate to "+expected);
    }
    await selectedSection(/^\[VLS_Module_Fwd_\{lr\}_\{rm\}\]$/i);
    await renderedModel(port,async()=>{
      const canvas=document.querySelector<HTMLCanvasElement>('canvas[aria-label*="spruance"]');
      if (!canvas) return "waiting for Spruance";
      const control=(id:string)=>document.querySelector<HTMLInputElement>("#"+id);
      const toggle=(id:string,on:boolean)=>{if(control(id).checked!==on) control(id).click();};
      const sample=document.createElement("canvas");
      sample.width=canvas.width; sample.height=canvas.height;
      const ctx=sample.getContext("2d");
      function pixels() {
        control("colliderWireframe").dispatchEvent(new Event("change"));
        ctx.clearRect(0,0,sample.width,sample.height);
        ctx.drawImage(canvas,0,0);
        return ctx.getImageData(0,0,sample.width,sample.height).data;
      }
      toggle("objects",false); toggle("meshes",true); toggle("colliders",false);
      const hull=pixels();
      toggle("meshes",false); toggle("colliders",true);
      control("colliderWireframe").value="shaded";
      const overlay=pixels();
      toggle("meshes",true);
      const combined=pixels();
      let overlap=0, obscured=0;
      const candidates:number[]=[];
      for (let i=0;i<hull.length;i+=4) {
        if (hull[i+3]!==255 || overlay[i+3]!==255 || overlay[i]!==255 || overlay[i+1]!==68 || overlay[i+2]!==68) continue;
        overlap++;
        candidates.push(i/4);
        if (combined[i]!==255 || combined[i+1]!==68 || combined[i+2]!==68) obscured++;
      }
      const rect=canvas.getBoundingClientRect(), tip=document.querySelector<HTMLElement>("#part-tip");
      let picked=false;
      for (let n=0;n<candidates.length && !picked;n+=Math.max(1,Math.floor(candidates.length/12))) {
        const pixel=candidates[n];
        canvas.dispatchEvent(new PointerEvent("pointermove",{
          clientX:rect.left+(pixel%sample.width+0.5)*rect.width/sample.width,
          clientY:rect.top+(Math.floor(pixel/sample.width)+0.5)*rect.height/sample.height}));
        await new Promise(requestAnimationFrame);
        picked=!tip.hidden && /Used by .*WeaponSystem\d+ \(/.test(tip.textContent);
      }
      control("colliderWireframe").value="wireframe";
      control("colliderWireframe").dispatchEvent(new Event("change"));
      toggle("objects",true);
      return picked && overlap && !obscured ? "verified controls" : "Weapon tooltip "+picked+", red overlap "+overlap+", obscured "+obscured;
    });
    await renderedModel(port,async()=>{
      if (!document.querySelector('canvas[aria-label*="spruance"]')) return "waiting for entity";
      const canvas=document.querySelector("canvas"), tip=document.querySelector<HTMLElement>("#part-tip");
      const meshes=document.querySelector<HTMLInputElement>("#meshes"), colliders=document.querySelector<HTMLInputElement>("#colliders");
      if (!meshes.checked) meshes.click();
      if (!colliders.checked) colliders.click();
      for (const [name,style,color] of [["coll_mk41_1","weapon","rgb(255, 68, 68)"],
        ["coll_ss_1","unassigned","rgb(192, 192, 192)"],["coll_mag_asroc","magazine","rgb(255, 131, 61)"],
        ["coll_mag_sparrow","magazine","rgb(255, 131, 61)"],["coll_hull_1","hull","rgb(255, 255, 255)"]]) {
        const label=Array.from(document.querySelectorAll<HTMLElement>("#outline .row."+style)).find(el=>el.textContent===name);
        if (!label || getComputedStyle(label).color!==color) return "waiting for "+name+" in "+color;
      }
      const box=canvas.getBoundingClientRect();
      for (const y of [0.5,0.45,0.55,0.4,0.6]) for (const x of [0.5,0.4,0.6]) {
        const pos={clientX:box.left+box.width*x,clientY:box.top+box.height*y,bubbles:true};
        canvas.dispatchEvent(new PointerEvent("pointermove",pos));
        await new Promise(requestAnimationFrame);
        if (tip.hidden || !tip.textContent.includes("Collider=")) continue;
        canvas.dispatchEvent(new PointerEvent("pointerdown",{...pos,ctrlKey:true}));
        canvas.dispatchEvent(new MouseEvent("click",{...pos,ctrlKey:true}));
        return "verified controls";
      }
      return "waiting for collider hover";
    });
    await selectedSection(/^\[coll_[^\]]+\]$/i);
    outcomes.push("Verified red weapon collider row and opened collider source over visible hull");
    const aircraft = vscode.Uri.joinPath(ini,"../../aircraft/usn_f-14a_squadrons.ini");
    await vscode.commands.executeCommand("seapower-ini.previewEntity",aircraft);
    await renderedModel(port,()=>{
      const selector = document.querySelector<HTMLSelectElement>("#appearance");
      const status = document.querySelector("[role=status]")?.textContent;
      if (!selector?.querySelector("option[value=Squadron2]") || !status?.includes("Drag to orbit")) return status || "waiting";
      const canvas = document.querySelector<HTMLCanvasElement>("canvas");
      if (canvas.getAttribute("aria-label").includes("Squadron1") && selector.value === "Squadron1") {
        document.querySelector("#meshWireframe").dispatchEvent(new Event("change"));
        canvas.dataset.firstPaint = canvas.toDataURL();
        selector.value = "Squadron2"; selector.dispatchEvent(new Event("change"));
        return "switching";
      }
      if (!canvas.getAttribute("aria-label").includes("Squadron2") || !canvas.dataset.firstPaint) return "waiting for squadron";
      document.querySelector("#meshWireframe").dispatchEvent(new Event("change"));
      return document.querySelector("#outline > ul")?.textContent.includes("Cockpit") && canvas.toDataURL() !== canvas.dataset.firstPaint ? "verified controls" : "unchanged squadron";
    });
    outcomes.push("Assembled F-14A and switched squadrons");
    const mission = vscode.Uri.joinPath(ini,"../../missions/Warsaw Pact/Northern Passage.ini");
    await vscode.commands.executeCommand("seapower-ini.previewEntity",mission);
    await renderedModel(port,()=>{
      const units = document.querySelector<HTMLSelectElement>("#entity");
      if (!units?.querySelector("option[value=Taskforce1Vessel1]") || !units.querySelector("option[value=Taskforce1Aircraft1]")) return "waiting for mission";
      if (units.value !== "Taskforce1Aircraft1") {
        units.value = "Taskforce1Aircraft1"; units.dispatchEvent(new Event("change")); return "switching mission unit";
      }
      return document.querySelector('canvas[aria-label*="Taskforce1Aircraft1"][aria-label*="Squadron2"]') && document.querySelector("#outline > ul")?.textContent.includes("usn_p-3c") ? "verified controls" : "waiting for P-3C";
    });
    outcomes.push("Selected the Northern Passage P-3C and its declared squadron");
    const nationDoc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(ini,"../../aircraft/fr_f1c_squadrons.ini"));
    await vscode.languages.setTextDocumentLanguage(nationDoc,"seapower-ini");
    const nationLine = nationDoc.getText().split(/\r?\n/).findIndex(l=>/^Nation=South_Africa/i.test(l));
    const defs = await vscode.commands.executeCommand<(vscode.Location|vscode.LocationLink)[]>("vscode.executeDefinitionProvider",nationDoc.uri,new vscode.Position(nationLine,9));
    assert.ok(defs.some(d=>/nations\.ini$/i.test(("uri" in d ? d.uri : d.targetUri).path)));
    outcomes.push("South_Africa links to the vanilla nations dictionary");
    await vscode.commands.executeCommand("workbench.action.openSettings","@id:seapowerIni.search.order");
    await renderedModel(port,()=>{
      const list=document.querySelector<HTMLElement>(".settings-editor .settings-tree-container");
      return list?.innerText.includes("projectRoot") && list.innerText.includes("workshop") ? "verified controls" : "waiting for search order list";
    });
    await vscode.commands.executeCommand("workbench.action.openSettings","@id:seapowerIni.search.projectRoot");
    await renderedModel(port,()=>document.querySelector('.settings-editor .settings-tree-container [role="checkbox"]') ? "verified controls" : "waiting for project root checkbox");
    outcomes.push("Search order list and project root checkbox displayed in VS Code Settings");
  }
  fs.writeFileSync(process.env.SP_INI_TEST_RESULT,outcomes.join("\n"));
};
