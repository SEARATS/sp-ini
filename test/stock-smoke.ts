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
    await renderedModel(port,()=>{
      const canvas=document.querySelector<HTMLCanvasElement>('canvas[aria-label*="spruance"]');
      const arcs=document.querySelector<HTMLInputElement>("#arcs"), colliders=document.querySelector<HTMLInputElement>("#colliders");
      if (!canvas || !arcs?.checked || !colliders?.checked || document.querySelector(".selected-object")) return "waiting for initial overlays";
      function pixels() {
        document.querySelector("#meshWireframe").dispatchEvent(new Event("change"));
        return canvas.toDataURL();
      }
      const initial=pixels();
      arcs.click(); const noArcs=pixels();
      colliders.click(); const noColliders=pixels();
      colliders.click(); arcs.click();
      return initial!==noArcs && noArcs!==noColliders && initial===pixels() ? "verified controls" : "initial overlays did not draw";
    });
    outcomes.push("Verified firing arcs and colliders render before selecting a system");
    outcomes.push("Assembled Spruance with nested and repeated submodels and variant selector");
    await renderedModel(port,()=>{
      const roots = Array.from(document.querySelectorAll("#outline > ul > li > details > summary")).map(el=>el.textContent);
      const row = Array.from(document.querySelectorAll<HTMLElement>("#outline [title]")).find(el=>el.title.startsWith("[SensorSystem2]\nSPS-40\nMount=SPS_40"));
      if (roots.join("/")!=="Meshes/Colliders/Objects" || !row) return "waiting for sensor tree";
      const checkbox = row.querySelector("input"), objects = document.querySelector<HTMLInputElement>("#objects");
      if (!checkbox?.checked) return "missing sensor marker";
      const arcs=document.querySelector<HTMLInputElement>("#arcs");
      if (arcs.checked) arcs.click();
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
      const arcs=document.querySelector<HTMLInputElement>("#arcs");
      if (arcs.checked) arcs.click();
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
      const weaponRow=document.querySelector<HTMLElement>('[data-part-id="coll_mk41_1"]');
      weaponRow.dispatchEvent(new PointerEvent("pointerenter"));
      ctx.drawImage(canvas,0,0);
      const highlighted=ctx.getImageData(0,0,sample.width,sample.height).data;
      weaponRow.dispatchEvent(new PointerEvent("pointerleave"));
      let brighter=false;
      let overlap=0, obscured=0;
      const candidates:number[]=[];
      for (let i=0;i<hull.length;i+=4) {
        if (hull[i+3]!==255 || overlay[i+3]!==255 || overlay[i]!==255 || overlay[i+1]!==68 || overlay[i+2]!==68) continue;
        overlap++;
        if (highlighted[i]===255 && highlighted[i+1]>combined[i+1]+20 && highlighted[i+2]>combined[i+2]+20) brighter=true;
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
        const entries=tip.textContent.split("\n\n"), headers=entries.map(entry=>entry.split("\n")[0]);
        picked=!tip.hidden && entries.length>1 && headers.every(header=>/^\[coll_/i.test(header)) &&
          new Set(headers).size===headers.length && /Used by .*WeaponSystem\d+ \(/.test(entries[0]);
      }
      control("colliderWireframe").value="wireframe";
      control("colliderWireframe").dispatchEvent(new Event("change"));
      toggle("objects",true);
      return brighter && picked && overlap && !obscured ? "verified controls" : "Highlight "+brighter+", weapon tooltip "+picked+", red overlap "+overlap+", obscured "+obscured;
    });
    await renderedModel(port,async()=>{
      if (!document.querySelector('canvas[aria-label*="spruance"]')) return "waiting for entity";
      const canvas=document.querySelector("canvas"), tip=document.querySelector<HTMLElement>("#part-tip");
      const meshes=document.querySelector<HTMLInputElement>("#meshes"), colliders=document.querySelector<HTMLInputElement>("#colliders");
      if (!meshes.checked) meshes.click();
      if (!colliders.checked) colliders.click();
      for (const [id,detail] of [["coll_mk41_1","Box"],["coll_sps_40","Sphere"],["coll_hull_1","Mesh · usn_dd_spruance_vls_coll_hull_1"]]) {
        const row=document.querySelector<HTMLElement>('[data-part-id="'+id+'"]');
        if (row?.title.split("\n")[1]!==detail) return "Missing collider type for "+id;
        if (!/^line \d+$/m.test(row.title) || /\.ini · line/i.test(row.title)) return "Unexpected local source for "+id;
      }
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
        if (tip.hidden || !tip.textContent.startsWith("[coll_")) continue;
        if (tip.textContent.includes("Collider=")) return "collider prefix still visible";
        canvas.dispatchEvent(new PointerEvent("pointerdown",{...pos,shiftKey:true}));
        canvas.dispatchEvent(new MouseEvent("click",{...pos,shiftKey:true}));
        return "verified controls";
      }
      return "waiting for collider hover";
    });
    await selectedSection(/^\[coll_[^\]]+\]$/i);
    await renderedModel(port,()=>{
      const row=document.querySelector<HTMLElement>('[data-part-id="coll_mk41_1"]');
      if (!row?.title.includes("choose system")) return "waiting for shared collider";
      row.dispatchEvent(new MouseEvent("click",{ctrlKey:true,bubbles:true,cancelable:true}));
      return "verified controls";
    });
    await renderedModel(port,()=>{
      const picker=document.querySelector<HTMLElement>(".quick-input-widget");
      return picker?.offsetHeight && picker.textContent.includes("[WeaponSystem4]") && picker.textContent.includes("[WeaponMagazineMK41_Fwd]") ?
        "verified controls" : "waiting for both owners";
    });
    await vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem");
    await selectedSection(/^\[WeaponSystem4\]$/i);
    await renderedModel(port,()=>{
      const row=document.querySelector<HTMLElement>('[data-part-id="coll_sps_40"]');
      if (!row?.title.includes("Shift+click: collider")) return "waiting for collider navigation";
      row.dispatchEvent(new MouseEvent("click",{ctrlKey:true,bubbles:true,cancelable:true}));
      return "verified controls";
    });
    await selectedSection(/^\[SensorSystem2\]$/i);
    outcomes.push("Verified overlapping collider tooltip entries, weapon-first order, and collider source navigation over the hull");
    // Exercise real document updates on a disposable copy of the stock ship.
    const editFile=vscode.Uri.joinPath(vscode.Uri.file(process.env.SP_INI_TEST_RESULT),"../spruance-preview-edits.ini");
    await vscode.workspace.fs.writeFile(editFile,Buffer.from(doc.getText()));
    const editDoc=await vscode.workspace.openTextDocument(editFile);
    await vscode.commands.executeCommand("seapower-ini.previewEntity",editFile);
    await renderedModel(port,()=>{
      const canvas=document.querySelector<HTMLCanvasElement>('canvas[aria-label*="spruance-preview-edits"]');
      const row=document.querySelector<HTMLElement>('[data-part-id="coll_mk41_1"]');
      if (!canvas || !row) return "waiting for editable ship";
      row.closest("details").open=true;
      row.dataset.testIdentity="before";
      canvas.dataset.oldTitle=row.title;
      canvas.dispatchEvent(new WheelEvent("wheel",{deltaY:-330,cancelable:true}));
      document.querySelector("#meshWireframe").dispatchEvent(new Event("change"));
      canvas.dataset.orbit=canvas.toDataURL();
      return "verified controls";
    });
    async function insert(position:vscode.Position,text:string) {
      const edit=new vscode.WorkspaceEdit();
      edit.insert(editFile,position,text);
      assert.ok(await vscode.workspace.applyEdit(edit));
    }
    await insert(new vscode.Position(0,0),"; edit preview test\n");
    await renderedModel(port,()=>{
      const canvas=document.querySelector<HTMLCanvasElement>("canvas[data-orbit]");
      const row=document.querySelector<HTMLElement>('[data-part-id="coll_mk41_1"]');
      if (!canvas || !row || row.title===canvas.dataset.oldTitle) return "waiting for source line update";
      document.querySelector("#meshWireframe").dispatchEvent(new Event("change"));
      return row.dataset.testIdentity==="before" && row.closest("details").open && canvas.toDataURL()===canvas.dataset.orbit ?
        "verified controls" : "camera or outline reset on comment edit";
    });
    await insert(editDoc.positionAt(editDoc.getText().length),"\n[CombatSystem999]\nSystemName=PreviewTest\n");
    await renderedModel(port,()=>{
      const canvas=document.querySelector<HTMLCanvasElement>("canvas[data-orbit]");
      const added=document.querySelector('[data-part-id="object:combatsystem999"]');
      if (!canvas || !added) return "waiting for new system";
      document.querySelector("#meshWireframe").dispatchEvent(new Event("change"));
      return document.querySelector('[data-part-id="coll_mk41_1"]').closest("details").open && canvas.toDataURL()===canvas.dataset.orbit ?
        "verified controls" : "camera or outline reset on structural edit";
    });
    await editDoc.save(); // Only the test session's copy is writable here.
    outcomes.push("Verified brighter collider pixels and retained the zoom and collider branch across live INI edits");
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
      const source=document.querySelector<HTMLElement>('[data-part-id="models"]')?.title || "";
      return document.querySelector('canvas[aria-label*="Taskforce1Aircraft1"][aria-label*="Squadron2"]') && /usn_p-3c\.ini · line \d+/i.test(source) ? "verified controls" : "waiting for P-3C source";
    });
    outcomes.push("Selected the Northern Passage P-3C and its declared squadron");
    await vscode.commands.executeCommand("seapower-ini.previewUnitCard",ini);
    await renderedModel(port,()=>{
      if (!document.querySelector<HTMLImageElement>("#profile")?.naturalWidth ||
        !document.querySelector("#facts")?.textContent.includes("172 m") || !document.querySelector("#groups")?.textContent.includes("SPS-40"))
        return "waiting for Spruance card";
      const rows=Array.from(document.querySelectorAll("#armament dl > div"));
      const weapons=rows.find(row=>row.firstElementChild.textContent==="Weapons:");
      const defences=rows.find(row=>row.firstElementChild.textContent==="Defences:");
      if (weapons?.textContent.includes("Chaff") || !defences?.textContent.includes("Chaff") || !defences.textContent.includes("Noisemaker"))
        return "waiting for stock countermeasures in Defences";
      if ([...document.querySelectorAll("#facts dt")].some(term=>term.textContent==="Range:") || !document.querySelector("#service").textContent.match(/198[78]/))
        return "waiting for the service years and particulars";
      const sensorTab=document.querySelector<HTMLButtonElement>("#tab-sensors");
      sensorTab.click();
      if (sensorTab.getAttribute("aria-selected")!=="true" || !document.querySelector<HTMLElement>("#sensors").offsetHeight) return "sensor tab inactive";
      document.querySelector<HTMLButtonElement>("#tab-overview").click();
      const variant=document.querySelector<HTMLSelectElement>("#appearance");
      if (variant.value!=="Variant2") {variant.value="Variant2";variant.dispatchEvent(new Event("change"));return "selecting variant";}
      return document.querySelector("h1").textContent.includes("Foster") ? "verified controls" : "waiting for variant name";
    });
    outcomes.push("Opened the stock Spruance Unit Reference, checked its profile, specifications and sensors, and switched ships");
    await vscode.commands.executeCommand("seapower-ini.previewUnitCard",editFile);
    const length=editDoc.getText().indexOf("Length=172")+"Length=172".length;
    await insert(editDoc.positionAt(length),".5");
    await renderedModel(port,()=>document.querySelector("#facts")?.textContent.includes("172.5 m") ?
      "verified controls" : "waiting for unsaved length");
    await editDoc.save();
    await vscode.commands.executeCommand("seapower-ini.previewUnitCard",aircraft);
    await renderedModel(port,()=>{
      const selector=document.querySelector<HTMLSelectElement>("#appearance");
      if (!selector?.querySelector("option[value=Squadron2]")) return "waiting for aircraft card";
      if (selector.value!=="Squadron2") {selector.value="Squadron2";selector.dispatchEvent(new Event("change"));}
      return document.querySelector("h1")?.textContent.includes("VF-24") && document.querySelector("#facts")?.textContent.includes("Wingspan") ?
        "verified controls" : "waiting for VF-24";
    });
    outcomes.push("Verified an unsaved unit-card edit and the F-14A squadron card");
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
