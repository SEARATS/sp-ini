// Run only in the disposable workspace created by test/preview.ps1.
const assert = require("node:assert/strict");
const vscode = require("vscode");

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
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, "preview-test-passed"), Buffer.from("ok"));
};
