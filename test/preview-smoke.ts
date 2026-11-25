// Run only in the disposable workspace created by test/preview.ps1.
import assert from "node:assert/strict";
import * as vscode from "vscode";

async function waitFor(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail("Timed out waiting for OBJ editor tabs: " + JSON.stringify(vscode.window.tabGroups.all.map(g => g.tabs.map(t => [t.label, (t.input instanceof vscode.TabInputCustom && t.input.viewType)]))));
}

export const run = async () => {
  const root = vscode.workspace.workspaceFolders[0].uri;
  assert.ok(root.path.endsWith("/preview-fixture"));
  const sonar = vscode.Uri.joinPath(root, "nested-mod/sonar.ini");
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(sonar));
  await waitFor(() => vscode.window.activeTextEditor?.document.languageId === "seapower-ini");
  await waitFor(() => vscode.extensions.getExtension("searats.seapower-ini").isActive);
  const outline = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>("vscode.executeDocumentSymbolProvider", sonar);
  assert.deepEqual(outline[0].children.map(key => key.name), ["BladesCount", "MinNoiseClassificationTreshold"]);
  const unrelated = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root, "unrelated.ini")));
  assert.equal(unrelated.document.languageId, "ini");
  const first = vscode.Uri.joinPath(root, "first.obj");
  await vscode.workspace.fs.writeFile(first, Buffer.from("# sample\no Mesh\nv 0 0 0\n"));
  await vscode.commands.executeCommand("vscode.openWith", first, "default");
  await waitFor(() => vscode.extensions.getExtension("searats.seapower-ini").isActive);
  const firstRanges = await vscode.commands.executeCommand<vscode.FoldingRange[]>("vscode.executeFoldingRangeProvider", first);
  assert.ok(firstRanges.some(range => range.start === 1 && range.end === 2), "OBJ source alone must activate folding");
  await vscode.commands.executeCommand("seapower-ini.referencePreviews");
  const local = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root, "missions/demo.ini"));
  await vscode.window.showTextDocument(local, { preview: false });
  for (const [line, id] of [[2, "stock_sample"], [4, "workshop_sample"]] as const) {
    const editor = await vscode.window.showTextDocument(local);
    editor.selection = new vscode.Selection(line, 7, line, 7);
    await vscode.commands.executeCommand("editor.action.revealDefinition");
    await waitFor(() => vscode.window.activeTextEditor?.document.uri.path.endsWith("/" + id + ".ini"));
    const target = vscode.window.activeTextEditor;
    assert.ok(target.document.uri.path.endsWith("/" + id + ".ini"), target.document.uri.path);
    assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab.isPreview, true);
    const prior = target.document.getText();
    await vscode.commands.executeCommand("default:type", { text: "x" });
    assert.equal(target.document.getText(), prior, "Reference should reject typing");
  }
  const group = vscode.window.tabGroups.activeTabGroup;
  assert.equal(group.tabs.filter(t => t.input instanceof vscode.TabInputText && t.input.uri.path.endsWith("/stock_sample.ini")).length, 0);
  await vscode.window.showTextDocument(local);
  await vscode.commands.executeCommand("default:type", { text: "x" });
  assert.ok(local.isDirty, "Local mod should accept typing");
  await vscode.commands.executeCommand("workbench.action.files.revert");
  const meshIni = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root, "vessels/mesh.ini"));
  const meshEditor = await vscode.window.showTextDocument(meshIni);
  const hullLine = meshIni.getText().split(/\r?\n/).findIndex(line => line === "Mesh=Hull");
  const list = await vscode.commands.executeCommand<vscode.CompletionList>("vscode.executeCompletionItemProvider",meshIni.uri,new vscode.Position(hullLine,9));
  const hull = list.items.filter(i=>["Hull","Hull_Col"].includes(String(i.label))).sort((a,b)=>a.sortText.localeCompare(b.sortText));
  assert.deepEqual(hull.map(i=>i.label),["Hull_Col","Hull"]);
  meshEditor.selection = new vscode.Selection(4, 6, 4, 6);
  const definitions = await vscode.commands.executeCommand<vscode.Location[]>("vscode.executeDefinitionProvider", meshIni.uri, meshEditor.selection.active);
  assert.ok(definitions.some(d => d.uri?.path.endsWith("/mesh.obj") && d.range.start.line === 3), JSON.stringify(definitions));
  await vscode.commands.executeCommand("editor.action.revealDefinition");
  await waitFor(() => vscode.window.activeTextEditor?.document.uri.path.endsWith("/mesh.obj"));
  const meshSource = vscode.window.activeTextEditor;
  assert.ok(meshSource?.document.uri.path.endsWith("/mesh.obj"), "Mesh definition opened " + JSON.stringify(vscode.window.tabGroups.activeTabGroup.activeTab?.input));
  assert.equal(meshSource.selection.active.line, 3);
  for (const [uri, line, char] of [[meshSource.document.uri, 3, 3], [meshIni.uri, 4, 6]] as const) {
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", uri, new vscode.Position(line, char));
    assert.ok(hovers.some(h => h.contents.some(c => (typeof c === "object" && c.value)?.toString().includes("data:image/png;base64,"))), "Mesh hover should contain an image");
  }
  const editSource = await vscode.window.showTextDocument(meshIni);
  await waitFor(() => vscode.languages.getDiagnostics(meshIni.uri).some(d => d.code === "invalid-value"));
  const fixes = await vscode.commands.executeCommand<vscode.CodeAction[]>("vscode.executeCodeActionProvider", meshIni.uri, meshIni.lineAt(6).range);
  const suppress = fixes.find(f => f.title === "Suppress invalid-value on this line");
  assert.ok(suppress?.edit);
  await vscode.workspace.applyEdit(suppress.edit);
  assert.equal(meshIni.lineAt(6).text, "ArmorType=Typo ; sp-ini-ignore invalid-value");
  await waitFor(() => !vscode.languages.getDiagnostics(meshIni.uri).some(d => d.code === "invalid-value"));
  editSource.selection = new vscode.Selection(4, 0, 4, 0);
  await vscode.commands.executeCommand("seapower-ini.toggleSection");
  await waitFor(() => meshIni.lineAt(4).text === "; Mesh=Part");
  await vscode.commands.executeCommand("seapower-ini.toggleSection");
  await waitFor(() => meshIni.lineAt(4).text === "Mesh=Part");
  await meshIni.save();
  const iniRanges = await vscode.commands.executeCommand<vscode.FoldingRange[]>("vscode.executeFoldingRangeProvider", local.uri);
  assert.ok(iniRanges.some(range => range.start === 1 && range.end === 2));
  const obj = vscode.Uri.joinPath(root, "triangle.obj");
  await vscode.workspace.fs.writeFile(obj, Buffer.from("o Triangle\ng Face\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\no Second\nf 3 2 1\n"));
  const groups = () => vscode.window.tabGroups.all.map(g => g.activeTab?.input);
  await vscode.commands.executeCommand("vscode.open", obj);
  await waitFor(() => groups().some(t => t instanceof vscode.TabInputCustom && t.viewType === "seapower-ini.obj" && t.uri.path === obj.path));
  assert.equal(vscode.window.tabGroups.all.length, 1, "Opening an OBJ should keep a single group by default");
  assert.ok(!vscode.window.tabGroups.all.flatMap(g => g.tabs).some(({ input }) =>
    input instanceof vscode.TabInputText && input.uri.path === obj.path));
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  await vscode.workspace.getConfiguration("seapowerIni").update("obj.openSourceBeside", true, vscode.ConfigurationTarget.Workspace);
  await vscode.commands.executeCommand("vscode.open", obj);
  await waitFor(() => groups().some(t => t instanceof vscode.TabInputCustom && t.viewType === "seapower-ini.obj" && t.uri.path === obj.path) &&
    groups().some(t => t instanceof vscode.TabInputText && t.uri.path === obj.path));
  const objRanges = await vscode.commands.executeCommand<vscode.FoldingRange[]>("vscode.executeFoldingRangeProvider", obj);
  assert.ok(objRanges.some(range => range.start === 0 && range.end === 5));
  assert.ok(objRanges.some(range => range.start === 1 && range.end === 5));
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  await vscode.workspace.getConfiguration("workbench").update("editorAssociations", { "*.obj": "default" }, vscode.ConfigurationTarget.Workspace);
  await vscode.commands.executeCommand("vscode.open", obj);
  await waitFor(() => vscode.window.activeTextEditor?.document.uri.path === obj.path);
  assert.ok(!groups().some(t => t instanceof vscode.TabInputCustom && t.viewType === "seapower-ini.obj"));
  const source = vscode.window.activeTextEditor;
  await waitFor(() => source.visibleRanges.some(range => range.start.line === 6));
  source.selection = new vscode.Selection(0, 0, 0, 0);
  await vscode.commands.executeCommand("cursorDown");
  assert.equal(source.selection.active.line, 6, "First object's body should be folded");
  await vscode.commands.executeCommand("cursorDown");
  assert.equal(source.selection.active.line, 8, "Second object's body should be folded");
  await vscode.commands.executeCommand("editor.unfold", { selectionLines: [0], levels: 1 });
  source.selection = new vscode.Selection(0, 0, 0, 0);
  await vscode.commands.executeCommand("cursorDown");
  assert.equal(source.selection.active.line, 1, "Individual objects can be expanded");
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, "preview-test-passed"), Buffer.from("ok"));
};
