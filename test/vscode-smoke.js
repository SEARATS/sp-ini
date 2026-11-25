// Pass this module to an isolated VS Code extension host with --extensionTestsPath.
const assert = require("node:assert/strict");
const vscode = require("vscode");

exports.run = async () => {
  const file = vscode.Uri.file(process.env.SEAPOWER_TEST_MISSION);
  const doc = await vscode.workspace.openTextDocument(file);
  assert.equal(doc.languageId, "seapower-ini", "stock missions should select Sea Power INI automatically");
  const editor = await vscode.window.showTextDocument(doc);
  const sample = await vscode.workspace.openTextDocument({ language: "seapower-ini",
    content: "[Mission]\n[Taskforce1Vessel1]\nType=" + process.env.SEAPOWER_TEST_UNIT + "\n" });
  await vscode.window.showTextDocument(sample);
  const extension = vscode.extensions.getExtension("searats.seapower-ini");
  await extension.activate();
  const request = (name, ...args) => vscode.commands.executeCommand("vscode.execute" + name + "Provider", sample.uri, ...args);
  const pos = new vscode.Position(2, sample.lineAt(2).text.length);
  const completion = await request("CompletionItem", pos);
  assert.ok(completion.items.some(i => i.label === process.env.SEAPOWER_TEST_UNIT), "unit completion");
  const definitions = await request("Definition", pos.translate(0, -1));
  assert.ok(definitions.some(d => (d.uri || d.targetUri).fsPath.toLowerCase().endsWith(process.env.SEAPOWER_TEST_UNIT.toLowerCase() + ".ini")), "unit definition");
  assert.ok((await request("Hover", pos.translate(0, -1))).length, "unit hover");
  assert.equal((await request("DocumentSymbol")).length, 2);
  await vscode.window.showTextDocument(editor.document);
};
