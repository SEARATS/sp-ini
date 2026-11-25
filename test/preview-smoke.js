// Run only in the disposable workspace created by test/preview.ps1.
const assert = require("node:assert/strict");
const vscode = require("vscode");

async function waitFor(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail("Timed out waiting for OBJ editor tabs: " + JSON.stringify(vscode.window.tabGroups.all.map(g => g.tabs.map(t => [t.label, t.input?.viewType]))));
}

exports.run = async () => {
  const root = vscode.workspace.workspaceFolders[0].uri;
  assert.ok(root.path.endsWith("/preview-fixture"));
  await vscode.commands.executeCommand("seapower-ini.referencePreviews");
  const local = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root, "missions/demo.ini"));
  await vscode.window.showTextDocument(local, { preview: false });
  for (const [line, id] of [[2, "stock_sample"], [4, "workshop_sample"]]) {
    const editor = await vscode.window.showTextDocument(local);
    editor.selection = new vscode.Selection(line, 7, line, 7);
    await vscode.commands.executeCommand("editor.action.revealDefinition");
    const target = vscode.window.activeTextEditor;
    assert.ok(target.document.uri.path.endsWith("/" + id + ".ini"), target.document.uri.path);
    assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab.isPreview, true);
    const prior = target.document.getText();
    await vscode.commands.executeCommand("default:type", { text: "x" });
    assert.equal(target.document.getText(), prior, "Reference should reject typing");
  }
  const group = vscode.window.tabGroups.activeTabGroup;
  assert.equal(group.tabs.filter(t => t.input?.uri?.path.endsWith("/stock_sample.ini")).length, 0);
  await vscode.window.showTextDocument(local);
  await vscode.commands.executeCommand("default:type", { text: "x" });
  assert.ok(local.isDirty, "Local mod should accept typing");
  await vscode.commands.executeCommand("workbench.action.files.revert");
  const iniRanges = await vscode.commands.executeCommand("vscode.executeFoldingRangeProvider", local.uri);
  assert.ok(iniRanges.some(range => range.start === 1 && range.end === 2));
  const obj = vscode.Uri.joinPath(root, "triangle.obj");
  await vscode.workspace.fs.writeFile(obj, Buffer.from("o Triangle\ng Face\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n"));
  await vscode.commands.executeCommand("vscode.open", obj);
  const groups = () => vscode.window.tabGroups.all.map(g => g.activeTab?.input);
  await waitFor(() => groups().some(t => t?.viewType === "seapower-ini.obj" && t.uri.path === obj.path) &&
    groups().some(t => t instanceof vscode.TabInputText && t.uri.path === obj.path));
  const objRanges = await vscode.commands.executeCommand("vscode.executeFoldingRangeProvider", obj);
  assert.ok(objRanges.some(range => range.start === 0 && range.end === 5));
  assert.ok(objRanges.some(range => range.start === 1 && range.end === 5));
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, "preview-test-passed"), Buffer.from("ok"));
};
