import * as vscode from "vscode";
import { basename, extname } from "node:path";
import { blendScales, exportBlend, findBlender, materialPath, outputStat, type ExportFormat } from "./blend-export";

export function registerBlendExport(context: vscode.ExtensionContext) {
  for (const format of Object.keys(blendScales) as ExportFormat[]) {
    const label = format.toUpperCase();
    context.subscriptions.push(vscode.commands.registerCommand("seapower-ini.exportBlend" + label, async (source?: vscode.Uri) => {
      if (source?.scheme !== "file" || extname(source.fsPath).toLowerCase() !== ".blend") return;
      try {
        const blender = await findBlender(vscode.workspace.getConfiguration("seapowerIni").get<string>("blenderPath"));
        const target = await vscode.window.showSaveDialog({
          title: "Export Blender scene as " + label, saveLabel: "Export " + label,
          defaultUri: source.with({path:source.path.slice(0,-6) + "." + format}), filters:{[label]:[format]}
        });
        if (!target) return;
        if (target.scheme !== "file") throw Error("Choose a local destination for the exported model.");
        if (format === "obj") {
          const mtl = materialPath(target.fsPath);
          if (await outputStat(mtl) &&
              await vscode.window.showWarningMessage("Replace the existing material library " + basename(mtl) + "?", {modal:true}, "Replace") !== "Replace") return;
        }
        await vscode.window.withProgress({location:vscode.ProgressLocation.Notification, title:"Exporting " + basename(source.fsPath) + " as " + label},
          () => exportBlend(blender, source.fsPath, target.fsPath, format));
        void vscode.window.showInformationMessage("Exported " + basename(target.fsPath));
      } catch (error) { void vscode.window.showErrorMessage("Blender export: " + error.message); }
    }));
  }
}
