const vscode = require("vscode");
const { LanguageClient, TransportKind } = require("vscode-languageclient/node");
const { referencePatterns } = require("./previews");
const { objFolds } = require("./folding");
const { registerObjPreview } = require("./obj-preview");
let client;

function registerObjFolding() {
  const seen = new WeakSet();
  const provider = vscode.languages.registerFoldingRangeProvider({ pattern: "**/*.[oO][bB][jJ]" }, {
    provideFoldingRanges: document => objFolds(document).map(r => new vscode.FoldingRange(r.startLine, r.endLine))
  });
  async function collapseObjects(editor) {
    const doc = editor?.document;
    if (!doc || !/\.obj$/i.test(doc.uri.path) || seen.has(doc)) return;
    seen.add(doc);
    if (!vscode.workspace.getConfiguration("seapowerIni", doc.uri).get("obj.collapseObjectsOnOpen")) return;
    const ranges = await vscode.commands.executeCommand("vscode.executeFoldingRangeProvider", doc.uri);
    if (vscode.window.activeTextEditor !== editor) { seen.delete(doc); return; }
    const selectionLines = (ranges || []).map(range => range.start).filter(line => /^\s*o(?:\s|$)/.test(doc.lineAt(line).text));
    if (selectionLines.length) await vscode.commands.executeCommand("editor.fold", { selectionLines, levels: 1, direction: "down" });
  }
  const onEditor = editor => collapseObjects(editor).catch(error => console.warn("OBJ folding:", error.message));
  const active = vscode.window.onDidChangeActiveTextEditor(onEditor);
  onEditor(vscode.window.activeTextEditor);
  return vscode.Disposable.from(provider, active);
}

function options() {
  const config = vscode.workspace.getConfiguration("seapowerIni");
  return { gameDirectory: config.get("gameDirectory"), localModDirectories: config.get("localModDirectories"),
    workshopDirectories: config.get("workshopDirectories") };
}

async function activate(context) {
  if (context.extensionMode === vscode.ExtensionMode.Development && process.env.SEAPOWER_DEV_RELOAD === "1") {
    const fs = require("node:fs");
    const stamp = context.asAbsolutePath("dist/.dev-build");
    const reload = () => vscode.commands.executeCommand("workbench.action.reloadWindow");
    fs.watchFile(stamp, { interval: 350 }, reload);
    context.subscriptions.push({ dispose: () => fs.unwatchFile(stamp, reload) });
  }
  context.subscriptions.push(registerObjPreview(context), registerObjFolding());
  client = new LanguageClient("seapower-ini", "Sea Power INI",
    { module: context.asAbsolutePath("dist/server.js"), transport: TransportKind.ipc },
    { documentSelector: [{ language: "seapower-ini", scheme: "file" }, { language: "seapower-ini", scheme: "untitled" }],
      initializationOptions: options() });
  await client.start();
  const rebuild = () => client.sendRequest("seapower/rebuild", { options: options(),
    folders: (vscode.workspace.workspaceFolders || []).map(f => ({ uri: f.uri.toString() })) });
  const update = () => rebuild().catch(error => client.error("Rebuilding content index", error));
  const watcher = vscode.workspace.createFileSystemWatcher("**/*.[iI][nN][iI]");
  let timer;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(update, 500);
  };
  context.subscriptions.push(
    watcher, watcher.onDidCreate(schedule), watcher.onDidChange(schedule), watcher.onDidDelete(schedule),
    { dispose: () => clearTimeout(timer) },
    vscode.commands.registerCommand("seapower-ini.referencePreviews", async () => {
      if (!vscode.workspace.workspaceFolders?.length) {
        await vscode.window.showInformationMessage("Open a mod folder to configure its reference previews.");
        return;
      }
      const config = vscode.workspace.getConfiguration();
      const key = "files.readonlyInclude";
      await config.update(key, { ...await referencePatterns(options()), ...config.inspect(key)?.workspaceValue }, vscode.ConfigurationTarget.Workspace);
      for (const setting of ["workbench.editor.enablePreview", "workbench.editor.enablePreviewFromCodeNavigation"]) {
        await config.update(setting, true, vscode.ConfigurationTarget.Workspace);
      }
    }),
    vscode.commands.registerCommand("seapower-ini.refresh", async () => vscode.window.showInformationMessage(await rebuild())),
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration("seapowerIni")) update(); }),
    vscode.workspace.onDidChangeWorkspaceFolders(update)
  );
}
async function deactivate() { await client?.stop(); }
module.exports = { activate, deactivate };
