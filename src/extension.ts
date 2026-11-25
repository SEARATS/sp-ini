import { registerHierarchy } from "./hierarchy-ui";
import * as vscode from "vscode";
import { LanguageClient, TransportKind } from "vscode-languageclient/node";
import { referencePatterns } from "./previews";
import { registerIniActions } from "./ini-actions";
import { registerObjPreview } from "./obj-preview";
let client;

function registerModIniLanguage() {
  const checked = new WeakSet();
  async function detect(editor) {
    const doc = editor.document;
    if (checked.has(editor) || doc.languageId !== "ini" || doc.uri.scheme !== "file" || !/\.ini$/i.test(doc.uri.path)) return;
    checked.add(editor);
    const workspace = vscode.workspace.getWorkspaceFolder(doc.uri);
    if (!workspace) return;
    const associations = vscode.workspace.getConfiguration("files", doc.uri).get("associations", {});
    if (Object.keys(associations).some(pattern => vscode.languages.match({ pattern: pattern.includes("/") ? pattern : "**/" + pattern }, doc))) return;
    for (let dir = vscode.Uri.joinPath(doc.uri, ".."); ; dir = vscode.Uri.joinPath(dir, "..")) {
      const marker = await vscode.workspace.fs.stat(vscode.Uri.joinPath(dir, "_info.ini")).then(stat => stat.type, () => 0);
      if (marker & vscode.FileType.File) {
        if (!doc.isClosed && doc.languageId === "ini") await vscode.languages.setTextDocumentLanguage(doc, "seapower-ini");
        return;
      }
      if (dir.path.toLowerCase() === workspace.uri.path.toLowerCase() || dir.path === vscode.Uri.joinPath(dir, "..").path) return;
    }
  }
  const visible = editors => editors.forEach(editor => detect(editor).catch(error => console.warn("Sea Power INI language detection:", error.message)));
  const subscription = vscode.window.onDidChangeVisibleTextEditors(visible);
  visible(vscode.window.visibleTextEditors);
  return subscription;
}

function registerObjFolding() {
  const seen = new WeakSet();
  async function collapseObjects(editor) {
    const doc = editor?.document;
    if (!doc || !/\.obj$/i.test(doc.uri.path) || seen.has(doc)) return;
    seen.add(doc);
    if (!vscode.workspace.getConfiguration("seapowerIni", doc.uri).get("obj.collapseObjectsOnOpen")) return;
    const ranges = await vscode.commands.executeCommand<vscode.FoldingRange[]>("vscode.executeFoldingRangeProvider", doc.uri);
    if (vscode.window.activeTextEditor !== editor) { seen.delete(doc); return; }
    const selectionLines = (ranges || []).map(range => range.start).filter(line => /^\s*o(?:\s|$)/.test(doc.lineAt(line).text));
    if (selectionLines.length) await vscode.commands.executeCommand("editor.fold", { selectionLines, levels: 1, direction: "down" });
  }
  const onEditor = editor => collapseObjects(editor).catch(error => console.warn("OBJ folding:", error.message));
  const active = vscode.window.onDidChangeActiveTextEditor(onEditor);
  onEditor(vscode.window.activeTextEditor);
  return active;
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
  registerHierarchy(context);
  context.subscriptions.push(registerModIniLanguage(), registerObjPreview(context), registerIniActions());
  client = new LanguageClient("seapower-ini", "Sea Power INI",
    { module: context.asAbsolutePath("dist/server.js"), transport: TransportKind.ipc },
    { documentSelector: [{ language: "seapower-ini", scheme: "file" }, { language: "seapower-ini", scheme: "untitled" },
        { language: "wavefront-obj", scheme: "file" }],
      initializationOptions: options(), middleware: {
        async provideDocumentLinks(doc, token, next) {
          const links = await next(doc, token);
          for (const link of links || []) {
            const target = link.target;
            const line = target?.path.toLowerCase().endsWith(".obj") && /^L(\d+),(\d+)$/.exec(target.fragment);
            if (!line) continue;
            const args = [target.with({ fragment: "" }).toString(), Number(line[1]) - 1, Number(line[2]) - 1];
            link.target = vscode.Uri.parse("command:seapower-ini.openObjSource?" + encodeURIComponent(JSON.stringify(args)));
          }
          return links;
        },
        async provideDefinition(doc, pos, token, next) {
          const result = await next(doc, pos, token);
          for (const location of Array.isArray(result) ? result : [result]) {
            if (!location || !('uri' in location) || !location.uri.path.toLowerCase().endsWith(".obj")) continue;
            const { start, end } = location.range;
            location.uri = location.uri.with({ fragment: "sp-ini-source=" + [start.line, start.character, end.character].join(",") });
          }
          return result;
        }
      } });
  await client.start();
  context.subscriptions.push(registerObjFolding());
  const rebuild = () => client.sendRequest("seapower/rebuild", { options: options(),
    folders: (vscode.workspace.workspaceFolders || []).map(f => ({ uri: f.uri.toString() })) });
  const update = () => rebuild().catch(error => client.error("Rebuilding content index", error));
  const watcher = vscode.workspace.createFileSystemWatcher("**/*.[iI][nN][iI]");
  const models = vscode.workspace.createFileSystemWatcher("**/*.{[oO][bB][jJ],[fF][bB][xX]}", false, true, false);
  let timer;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(update, 500);
  };
  context.subscriptions.push(
    watcher, watcher.onDidCreate(schedule), watcher.onDidChange(schedule), watcher.onDidDelete(schedule),
    models, models.onDidCreate(schedule), models.onDidDelete(schedule),
    { dispose: () => clearTimeout(timer) },
    vscode.commands.registerCommand("seapower-ini.referencePreviews", async () => {
      if (!vscode.workspace.workspaceFolders?.length) {
        await vscode.window.showInformationMessage("Open a mod folder to configure its reference previews.");
        return;
      }
      const config = vscode.workspace.getConfiguration();
      const key = "files.readonlyInclude";
      await config.update(key, { ...await referencePatterns(options()), ...config.inspect<Record<string, boolean>>(key)?.workspaceValue }, vscode.ConfigurationTarget.Workspace);
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
export { activate, deactivate };
