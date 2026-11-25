// Run with VS Code --extensionTestsPath against an installed game or exported workspace.
import * as vscode from "vscode";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { renderedModel } from "../scripts/gallery/webview";
function checkPreviewControls() {
  const canvas = document.querySelector("canvas[aria-label]") as HTMLCanvasElement;
  if (!canvas || !document.querySelector("[role=status]")?.textContent.includes("Drag to orbit")) return "loading";
  const icon = document.querySelector<SVGElement>("#outline li .collider-icon");
  if (!icon) return "waiting for colliders";
  const row = icon.closest("li"), part = icon.closest(".row").querySelector("input");
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
          outcomes.push("FBX collider icon, visibility, category filters and wireframe verified");
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
      if (!document.querySelector('canvas[aria-label*="spruance"]')) return "waiting for entity";
      const canvas=document.querySelector("canvas"), tip=document.querySelector<HTMLElement>("#part-tip");
      const meshes=document.querySelector<HTMLInputElement>("#meshes"), colliders=document.querySelector<HTMLInputElement>("#colliders");
      if (meshes.checked) meshes.click();
      if (!colliders.checked) colliders.click();
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
    outcomes.push("Opened repeated mesh source from hierarchy and collider source from viewport");
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
