const vscode = require("vscode");
const { LanguageClient, TransportKind } = require("vscode-languageclient/node");
let client;

function options() {
  const config = vscode.workspace.getConfiguration("seapowerIni");
  return { gameDirectory: config.get("gameDirectory"), localModDirectories: config.get("localModDirectories"),
    workshopDirectories: config.get("workshopDirectories") };
}

async function activate(context) {
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
    vscode.commands.registerCommand("seapower-ini.refresh", async () => vscode.window.showInformationMessage(await rebuild())),
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration("seapowerIni")) update(); }),
    vscode.workspace.onDidChangeWorkspaceFolders(update)
  );
}
async function deactivate() { await client?.stop(); }
module.exports = { activate, deactivate };
