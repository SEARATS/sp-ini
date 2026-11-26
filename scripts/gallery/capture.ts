import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { camera, delay, waitFor } from "./camera";
import { renderedModel } from "./webview";
import { inspectSpruance } from "./entity";

const command = <T = void>(id: string, ...args: unknown[]) => vscode.commands.executeCommand<T>(id, ...args);
function select(editor, position) {
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(editor.selection, vscode.TextEditorRevealType.InCenter);
}

async function capture(screen) {
  const workspace = vscode.workspace.workspaceFolders[0].uri;
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(workspace, "vessels/usn_dd_spruance_vls.ini"));
  let editor = await vscode.window.showTextDocument(doc);
  await vscode.extensions.getExtension("searats.seapower-ini").activate();
  await command("workbench.action.closeSidebar");
  await command("workbench.action.closeAuxiliaryBar");
  function position(text) {
    const lines = doc.getText().split(/\r\n|\r|\n/);
    const line = lines.findIndex(l => l.trim() === text);
    assert.ok(line >= 0, "Stock INI line missing: " + text);
    return new vscode.Position(line, Math.max(1, lines[line].indexOf("=") + 3));
  }
  async function hover(source, pos, file, title, expected, lineText) {
    await command("editor.action.hideHover");
    select(source, pos);
    await command("vscode.executeHoverProvider", source.document.uri, pos);
    await delay(180);
    for (let attempt = 0; ; attempt++) {
      await command("editor.action.showHover");
      try {
        for (const [alt, count] of Object.entries(expected)) await screen.rendered(alt, count);
        break;
      } catch (error) {
        if (attempt === 2) throw error;
        await command("editor.action.hideHover");
        await vscode.window.showTextDocument(source.document);
        select(source, pos);
      }
    }
    await screen.capture(file, title, { lines: [lineText], widget: ".monaco-hover" });
    await command("editor.action.hideHover");
  }

  const mesh = "Mesh=usn_dd_spruance_vls_deck", mat = "Material=usn_dd_spruance_vls_deck_mat.ini", header = "[Deck]";
  const p = position(mesh);
  const links = await command<vscode.DocumentLink[]>("vscode.executeLinkProvider", doc.uri);
  assert.ok(links.some(link => link.range.contains(p) && link.target));
  select(editor, p);
  await screen.capture("01-mesh-links", "Mesh and material links", { lines: [mesh, mat] });
  await hover(editor, p, "02-mesh-hover", "Wireframe and textured mesh", { "Object wireframe": 1, "Textured object": 1 }, mesh);
  await hover(editor, position(mat), "03-material-hover", "Lit material and texture maps", { "Lit material": 1, Texture: 3 }, mat);

  const collider = "Collider=usn_dd_spruance_vls_coll_hull_1";
  await hover(editor, position(collider), "04-mesh-collider", "Mesh collider geometry", { "Object wireframe": 1 }, collider);
  await hover(editor, position("[coll_rudder_port]"), "05-box-collider", "Box collider shape and dimensions", { "Collider shape": 1 }, "[coll_rudder_port]");
  const parts = ["ContainerBase=MK45_Gun_1", "Gun1=MK45_Barrel_1"];
  for (const part of parts) assert.ok(links.some(l => l.range.contains(position(part)) && l.target?.fragment.startsWith("L")), part);
  select(editor, position(parts[1]));
  await screen.capture("06-model-part-links", "Mount and barrel definitions", { lines: parts });
  await command("editor.action.revealDefinition");
  await waitFor(() => editor.selection.active.line === position("[MK45_Barrel_1]").line, "Gun definition");

  select(editor, p);
  await command("editor.action.revealDefinition");
  await waitFor(() => vscode.window.activeTextEditor?.document.uri.path.endsWith(".obj"), "OBJ source navigation");
  const source = vscode.window.activeTextEditor;
  const objectLine = "o usn_dd_spruance_vls_deck";
  await waitFor(() => source.document.lineAt(source.selection.active.line).text === objectLine, "OBJ object selection");
  const objPosition = new vscode.Position(source.selection.active.line, 6);
  await command("editor.unfold", { selectionLines: [objPosition.line], levels: 1 });
  await hover(source, objPosition, "07-obj-source-hover", "Object preview in OBJ source", { "Textured object": 1 }, objectLine);
  await command("editor.foldAll");
  await command("cursorTop");
  await screen.capture("08-obj-folding", "Collapsed OBJ objects", { lines: ["o usn_dd_spruance_vls", "o usn_dd_spruance_vls_coll_hull_1"] });
  await command("vscode.openWith", vscode.Uri.joinPath(workspace, "ships/usn_dd_spruance_vls/spruance_vls_exterior.obj"), "seapower-ini.obj", { preview: false });
  await delay(2200);
  await screen.capture("09-obj-preview", "Spruance VLS in the 3D preview", { canvas: true });

  editor = await vscode.window.showTextDocument(doc);
  const general = position("[General]");
  select(editor, general);
  await command("editor.fold", { selectionLines: [general.line], levels: 1, direction: "down" });
  await command("cursorDown");
  assert.ok(editor.selection.active.line > general.line + 1, "Expected a collapsed INI section");
  select(editor, general);
  await screen.capture("10-ini-folding", "Collapsed INI section", { lines: ["[General]"], after: 2 });
  await command("editor.unfold", { selectionLines: [general.line], levels: 1, direction: "down" });

  // All demonstration edits are made to the disposable stock INI copy.
  const armor = doc.getText().split(/\r\n|\r|\n/).findIndex(l => l.startsWith("ArmorType="));
  await editor.edit(edit => edit.replace(doc.lineAt(armor).range, "ArmorType=He"));
  select(editor, new vscode.Position(armor, 12));
  await command("editor.action.triggerSuggest");
  await screen.capture("11-completion", "Value completion", { lines: ["ArmorType=He"], widget: ".suggest-widget.visible" });
  await command("hideSuggestWidget");
  await editor.edit(edit => edit.replace(doc.lineAt(armor).range, "ArmorType=Heavy\nArmorType=Heavy\nArmorType=Minor"));
  select(editor, new vscode.Position(armor + 2, 3));
  await waitFor(() => vscode.languages.getDiagnostics(doc.uri).some(d => d.code === "conflicting-duplicate-key" &&
    d.range.start.line === armor + 2), "Conflicting duplicate diagnostic");
  await command("editor.action.showHover");
  await screen.capture("12-duplicate-diagnostics", "Duplicate warning and conflicting-value error", { lines: ["ArmorType=Heavy", "ArmorType=Minor"], widget: ".monaco-hover" });
  await command("editor.action.hideHover");
  await command("editor.action.codeAction", { kind: "quickfix", apply: "never" });
  await screen.capture("13-quick-fix", "Diagnostic quick fix", { lines: ["ArmorType=Minor"], widget: ".action-widget" });
  await screen.escape();
  await command("seapower-ini.suppress");
  await waitFor(() => doc.lineAt(armor + 2).text.endsWith("; sp-ini-ignore conflicting-duplicate-key"), "Inline suppression");
  await screen.capture("14-inline-suppression", "Same-line diagnostic suppression", { lines: ["ArmorType=Heavy", "ArmorType=Minor ; sp-ini-ignore"] });
  const section = position(header);
  select(editor, section);
  await command("seapower-ini.toggleSection");
  await waitFor(() => doc.lineAt(section.line).text.startsWith("; sp-ini-off"), "Comment section");
  await screen.capture("15-section-toggle", "Commented INI section", { lines: ["; sp-ini-off " + header, "; Mesh=usn_dd_spruance_vls_deck", "; Material=usn_dd_spruance_vls_deck_mat.ini"] });
  await command("seapower-ini.toggleSection");
  await doc.save();

  await command("seapower-ini.referencePreviews");
  const stock = vscode.Uri.file(path.join(process.env.SP_GALLERY_GAME, "Sea Power_Data/StreamingAssets/original/vessels/usn_dd_spruance_vls.ini"));
  const ref = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(stock), { preview: true });
  select(ref, new vscode.Position(3, 1));
  await waitFor(() => vscode.window.tabGroups.activeTabGroup.activeTab?.isPreview, "Reference tab");
  await screen.capture("16-read-only-reference", "Read-only stock reference", { tab: true, lines: ["[General]", "UnitType=Vessel"] });
  const fbx = vscode.Uri.joinPath(workspace, "ships/usn_dd_spruance_vls/spruance_vls_exterior.fbx");
  if (await fs.stat(fbx.fsPath).then(() => true, () => false)) {
    await command("vscode.open", fbx);
    await waitFor(() => (vscode.window.tabGroups.activeTabGroup.activeTab?.input as vscode.TabInputCustom)?.viewType === "seapower-ini.fbx", "Default FBX viewer");
    await delay(2200);
    await screen.capture("17-fbx-preview", "Spruance VLS in the FBX viewer", { canvas: true });
  }
  await command("workbench.action.closeAllEditors");
  await screen.resize(920, 600);
  await command("vscode.openWith", stock, "seapower-ini.entity", vscode.ViewColumn.One);
  const port = Number(process.env.SP_GALLERY_PORT);
  await renderedModel(port, inspectSpruance, "mesh");
  await screen.capture("18-entity-mesh-hover", "Mesh tooltip on the assembled Spruance", { preview: [0,0.40,0.85,1] });
  await renderedModel(port, inspectSpruance, "trees");
  await screen.capture("22-entity-trees", "Meshes, colliders and system markers on the Spruance", { preview: [0,0,0.82,0.92] });
  await renderedModel(port, inspectSpruance, "overlap");
  await screen.capture("23-collider-highlight", "Highlighted colliders with the weapon system first in the tooltip", { preview: [0,0.44,1,1] });
  await renderedModel(port, inspectSpruance, "sphere");
  await screen.capture("19-sphere-colliders", "Sphere collider wireframes and INI source tooltip", { preview: [0,0.40,0.95,1] });
  await renderedModel(port, inspectSpruance, "open");
  await waitFor(() => {
    const target = vscode.window.activeTextEditor;
    return target?.document.uri.toString() === stock.toString() && /^\[coll_/i.test(target.document.getText(target.selection))
      && target.document.lineAt(target.selection.start.line + 1).text.trim() === "Collider=Sphere";
  }, "Ctrl+click on the rendered sphere did not select its INI definition");
  const target = vscode.window.activeTextEditor;
  target.revealRange(target.selection, vscode.TextEditorRevealType.InCenter);
  await screen.capture("20-preview-definition", "Ctrl+click opens the collider definition beside the preview", { preview: true });
  await screen.resize(1180, 560);
  await renderedModel(port, inspectSpruance, "hierarchy");
  await waitFor(() => target.document.getText(target.selection) === "[VLS_Module_Fwd_{lr}_{rm}]", "Hierarchy link to repeat template");
  target.revealRange(target.selection, vscode.TextEditorRevealType.InCenter);
  await screen.capture("21-hierarchy-definition", "Repeated mesh and its source template", { preview: true });
  await screen.finish();
}

export const run = async () => {
  const screen = await camera();
  try {
    await capture(screen);
    await fs.writeFile(process.env.SP_GALLERY_RESULT, "ok");
  } catch (error) {
    await fs.writeFile(process.env.SP_GALLERY_RESULT, error.stack || error.message);
    throw error;
  } finally { screen.close(); }
};
