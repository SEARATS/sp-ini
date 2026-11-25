// Pass this module to an isolated VS Code extension host with --extensionTestsPath.
import assert from "node:assert/strict";
import * as vscode from "vscode";

export const run = async () => {
  const file = vscode.Uri.file(process.env.SEAPOWER_TEST_MISSION);
  const doc = await vscode.workspace.openTextDocument(file);
  assert.equal(doc.languageId, "seapower-ini", "stock missions should select Sea Power INI automatically");
  const editor = await vscode.window.showTextDocument(doc);
  const sample = await vscode.workspace.openTextDocument({ language: "seapower-ini",
    content: "[Mission]\n[Taskforce1Vessel1]\nType=" + process.env.SEAPOWER_TEST_UNIT + "\n" });
  await vscode.window.showTextDocument(sample);
  const extension = vscode.extensions.getExtension("searats.seapower-ini");
  await extension.activate();
  const request = <T>(name: string, ...args: unknown[]) => vscode.commands.executeCommand<T>("vscode.execute" + name + "Provider", sample.uri, ...args);
  const pos = new vscode.Position(2, sample.lineAt(2).text.length);
  const completion = await request<vscode.CompletionList>("CompletionItem", pos);
  assert.ok(completion.items.some(i => i.label === process.env.SEAPOWER_TEST_UNIT), "unit completion");
  const definitions = await request<(vscode.Location | vscode.LocationLink)[]>("Definition", pos.translate(0, -1));
  assert.ok(definitions.some(d => ("uri" in d ? d.uri : d.targetUri).fsPath.toLowerCase().endsWith(process.env.SEAPOWER_TEST_UNIT.toLowerCase() + ".ini")), "unit definition");
  assert.ok((await request<vscode.Hover[]>("Hover", pos.translate(0, -1))).length, "unit hover");
  assert.equal((await request<vscode.DocumentSymbol[]>("DocumentSymbol")).length, 2);
  const vessel = await vscode.workspace.openTextDocument({ language: "seapower-ini",
    content: "[General]\nUnitType=Vessel\nArmorType=Heavyd\n[SensorSystem1]\nSystemName=SPS-48" });
  await vscode.window.showTextDocument(vessel);
  const checkArmor = async invalid => {
    for (let i = 0; i < 80; i++) {
      const issues = vscode.languages.getDiagnostics(vessel.uri);
      if (issues.some(d => d.severity === vscode.DiagnosticSeverity.Error && d.message.includes("Heavyd")) === invalid) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail("Expected armor error present=" + invalid);
  };
  await checkArmor(true);
  const sensors = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>("vscode.executeDefinitionProvider", vessel.uri, new vscode.Position(4, 13));
  assert.ok(sensors.some(d => ("uri" in d ? d.uri : d.targetUri).fsPath.endsWith("sensors.ini")));
  const edit = new vscode.WorkspaceEdit();
  edit.replace(vessel.uri, new vscode.Range(2, 10, 2, 16), "Heavy");
  assert.ok(await vscode.workspace.applyEdit(edit));
  await checkArmor(false);
  await vscode.window.showTextDocument(editor.document);
};
