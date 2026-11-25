const vscode = require("vscode");
const { suppression, sectionEdit } = require("./ini-edits");

function workspaceEdit(document, edits) {
  const edit = new vscode.WorkspaceEdit();
  for (const { line, start, length = 0, text } of edits) {
    edit.replace(document.uri, new vscode.Range(line, start, line, start + length), text);
  }
  return edit;
}

function fixes(document, range, diagnostics) {
  const actions = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.source !== "Sea Power INI" || !diagnostic.range.intersection(range)) continue;
    const code = diagnostic.code?.value ?? diagnostic.code;
    if (typeof code !== "string") continue;
    const line = diagnostic.range.start.line;
    const change = suppression(document.lineAt(line).text, line, code);
    if (!change) continue;
    const action = new vscode.CodeAction("Suppress " + code + " on this line", vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];
    action.edit = workspaceEdit(document, [change]);
    actions.push(action);
  }
  return actions;
}

function registerIniActions() {
  const suppress = vscode.commands.registerTextEditorCommand("seapower-ini.suppress", async editor => {
    const doc = editor.document;
    const version = doc.version;
    const actions = fixes(doc, doc.lineAt(editor.selection.active.line).range, vscode.languages.getDiagnostics(doc.uri));
    if (!actions.length) return vscode.window.showInformationMessage("No Sea Power INI diagnostic on this line.");
    const choice = actions.length === 1 ? actions[0] : (await vscode.window.showQuickPick(actions.map(action => ({
      label: action.title, detail: action.diagnostics[0].message, action
    }))))?.action;
    if (choice && doc.version === version) await vscode.workspace.applyEdit(choice.edit);
  });
  const toggle = vscode.commands.registerTextEditorCommand("seapower-ini.toggleSection", editor => {
    const doc = editor.document;
    const section = sectionEdit(doc.getText().split(/\r\n|\r|\n/), editor.selection.active.line);
    if (section) return vscode.workspace.applyEdit(workspaceEdit(doc, section.edits));
  });
  const provider = vscode.languages.registerCodeActionsProvider("seapower-ini", {
    provideCodeActions: (doc, range, context) => fixes(doc, range, context.diagnostics)
  }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] });
  return vscode.Disposable.from(suppress, toggle, provider);
}

module.exports = { registerIniActions };
