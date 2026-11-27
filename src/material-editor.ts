import * as vscode from "vscode";
import type { Materials } from "./materials";

type Preview = Awaited<ReturnType<Materials["preview"]>>;
const html = (s: string) => s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
function content(preview: Preview) {
  const figure = (label: string, detail: string, image?: string, status = "") =>
    '<figure>' + (image ? '<img alt="'+html(label)+'" src="'+html(image)+'">' : html(status)) +
    '<figcaption>'+html(label)+(detail ? '<br><small>'+html(detail)+'</small>' : '')+'</figcaption></figure>';
  const figures = preview.maps.map(m => figure(m.slot,m.path,m.image,m.status));
  if (preview.lit) figures.unshift(figure("Lit material","",preview.lit));
  const properties = preview.properties.map(p => "<tr><td>"+html(p.name)+"</td><td>"+html(p.value)+"</td></tr>").join("");
  const issues = preview.issues.map(message => "<li>"+html(message)+"</li>").join("");
  return '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'">' +
    '<style>main{display:flex;flex-wrap:wrap;gap:1.2rem}figure{margin:0}figcaption{margin:.4em 0}small{overflow-wrap:anywhere}img{max-width:100%;height:auto}</style>' +
    '<h2>'+html(preview.name)+'</h2><main>'+(figures.join("") || html(preview.note || "No texture or color properties to preview."))+'</main>'+
    (issues ? '<ul aria-label="Material problems">'+issues+'</ul>' : '')+
    (properties ? '<details><summary>Properties</summary><table>'+properties+'</table></details>' : '');
}

export function registerMaterialPreview(request: (uri:string)=>Promise<Preview>, indexed: vscode.Event<void>) {
  return vscode.window.registerCustomEditorProvider("seapower-ini.material", {
    openCustomDocument(uri) { return {uri,dispose(){}}; },
    resolveCustomEditor({uri},panel) {
      let revision = 0;
      async function refresh() {
        const current = ++revision;
        try {
          const preview = await request(uri.toString());
          if (current === revision) panel.webview.html = content(preview);
        } catch (e) {
          if (current === revision) panel.webview.html = html(String(e));
        }
      }
      const saved = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.joinPath(uri,".."),"*"));
      const reload = (file:vscode.Uri) => { if (file.toString() === uri.toString()) void refresh(); };
      saved.onDidChange(reload);
      saved.onDidCreate(reload);
      const index = indexed(refresh);
      panel.onDidDispose(() => { revision++; saved.dispose(); index.dispose(); });
      void refresh();
    }
  });
}
