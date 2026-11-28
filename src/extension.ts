import { registerMaterialPreview } from "./material-editor";
import { registerBlendExport } from "./blend-export-ui";
import { registerHierarchy } from "./hierarchy-ui";
import { watchFile, unwatchFile, type Stats } from "node:fs";
import * as vscode from "vscode";
import { LanguageClient, ProgressType, TransportKind } from "vscode-languageclient/node";
import { randomUUID } from "node:crypto";
import type { EntityProgress } from "./entity-model";
import { referencePatterns } from "./previews";
import { registerIniActions } from "./ini-actions";
import { registerObjPreview } from "./obj-preview";
import {registerUnitCard} from "./unit-card-editor";
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
  return { blenderPath:config.get("blenderPath"), unitHints: config.get("unitHints.enabled"), search: config.get("search"), searchPaths: config.get("searchPaths"),
    gameDirectory: config.get("gameDirectory"), localModDirectories: config.get("localModDirectories"),
    workshopDirectories: config.get("workshopDirectories") };
}

async function activate(context) {
  if (context.extensionMode === vscode.ExtensionMode.Development && process.env.SEAPOWER_DEV_RELOAD === "1") {
    const stamp = context.asAbsolutePath("dist/.dev-build");
    // A missing stamp also triggers watchFile when the development host starts.
    const onBuild = (current: Stats, previous: Stats) => {
      if (current.nlink && current.mtimeMs !== previous.mtimeMs) {
        void vscode.commands.executeCommand("workbench.action.reloadWindow");
      }
    };
    watchFile(stamp, { interval: 350 }, onBuild);
    context.subscriptions.push({ dispose: () => unwatchFile(stamp, onBuild) });
  }
  registerHierarchy(context);
  registerBlendExport(context);
  const indexed = new vscode.EventEmitter<void>();
  context.subscriptions.push(registerUnitCard(context,(params,token)=>client.sendRequest("seapower/entityPreview",params,token),indexed.event));
  const requestEntity = async (params,token,onChunk?:(chunk:EntityProgress)=>void) => {
    const progressToken = onChunk && randomUUID();
    const listener = onChunk && client.onProgress(new ProgressType<EntityProgress>(),progressToken,onChunk);
    try { return await client.sendRequest("seapower/entityPreview",{...params,progressToken},token); }
    finally { listener?.dispose(); }
  };
  context.subscriptions.push(indexed, registerModIniLanguage(), registerObjPreview(context,requestEntity,indexed.event), registerIniActions());
  client = new LanguageClient("seapower-ini", "Sea Power INI",
    { module: context.asAbsolutePath("dist/server.js"), transport: TransportKind.ipc },
    { documentSelector: [{ language: "seapower-ini", scheme: "file" }, { language: "seapower-ini", scheme: "untitled" },
        { language: "wavefront-obj", scheme: "file" }, {scheme:"file",pattern:"**/*.[mM][aA][tT]"}],
      initializationOptions: {...options(),previewCacheDirectory:vscode.Uri.joinPath(context.globalStorageUri,"entity-assets-v1").fsPath}, middleware: {
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
  context.subscriptions.push(registerMaterialPreview(uri => client.sendRequest("seapower/materialPreview",{uri}),indexed.event));
  context.subscriptions.push(registerObjFolding());
  const rebuild = async () => {
    const result = await client.sendRequest("seapower/rebuild", { options: options(),
      folders: (vscode.workspace.workspaceFolders || []).map(f => ({ uri: f.uri.toString() })) });
    indexed.fire();
    return result;
  };
  const update = () => rebuild().catch(error => client.error("Rebuilding content index", error));
  const textures = ["[pP][nN][gG]","[jJ][pP][gG]","[jJ][pP][eE][gG]","[tT][gG][aA]","[dD][dD][sS]"];
  const watcher = vscode.workspace.createFileSystemWatcher("**/*.{[iI][nN][iI]," + textures.map(ext=>ext+".meta").join(",") + "}");
  const assets = vscode.workspace.createFileSystemWatcher("**/*.{[oO][bB][jJ],[fF][bB][xX],[bB][lL][eE][nN][dD],[mM][aA][tT]," + textures.join(",") + "}", false, true, false);
  let timer;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(update, 500);
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("seapower-ini.analyze", async () => {
      const workspace = (vscode.workspace.workspaceFolders || []).filter(f => f.uri.scheme === "file");
      const scopes = [{label:"Vanilla game", description:"Check the installed original INIs", vanilla:true}];
      if (workspace.length) scopes.unshift({label:"Entire workspace", description:"Check saved INIs in all workspace folders", vanilla:false});
      const scope = await vscode.window.showQuickPick(scopes, {title:"Analyze Sea Power INI files"});
      if (!scope) return;
      await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:"Analyzing " + scope.label,cancellable:true},async (_,token)=>{
        try {
          const summary = await client.sendRequest("seapower/analyze",{vanilla:scope.vanilla},token);
          if (!summary || token.isCancellationRequested) return;
          await vscode.commands.executeCommand("workbench.actions.view.problems");
          void vscode.window.showInformationMessage(summary);
        } catch (error) { if (!token.isCancellationRequested) void vscode.window.showErrorMessage(error.message); }
      });
    }),
    watcher, watcher.onDidCreate(schedule), watcher.onDidChange(schedule), watcher.onDidDelete(schedule),
    assets, assets.onDidCreate(schedule), assets.onDidDelete(schedule),
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
    vscode.commands.registerCommand("seapower-ini.refresh", async () => { void vscode.window.showInformationMessage(await rebuild()); }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration("seapowerIni.unitHints.enabled"))
        void client.sendNotification("seapower/unitHints", options().unitHints);
      if (["blenderPath","search", "searchPaths", "gameDirectory", "localModDirectories", "workshopDirectories"]
        .some(key => event.affectsConfiguration("seapowerIni." + key))) update();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(update)
  );
}
async function deactivate() { await client?.stop(); }
export { activate, deactivate };
