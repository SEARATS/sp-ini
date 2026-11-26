import {randomBytes} from "node:crypto";
import * as vscode from "vscode";
import type {PreviewRequest} from "./entity-selection";
import type {unitCard} from "./unit-card";

type RequestCard=(request:PreviewRequest,token:vscode.CancellationToken)=>Promise<Awaited<ReturnType<typeof unitCard>>>;
export function registerUnitCard(context:vscode.ExtensionContext, request:RequestCard, indexed:vscode.Event<void>) {
  const view="seapower-ini.card", dist=vscode.Uri.joinPath(context.extensionUri,"dist");
  const open=vscode.commands.registerCommand("seapower-ini.previewUnitCard",(resource?:vscode.Uri)=>{
    const uri=resource || vscode.window.activeTextEditor?.document.uri;
    if (uri) return vscode.commands.executeCommand("vscode.openWith",uri,view,vscode.ViewColumn.Beside);
  });
  const provider=vscode.window.registerCustomEditorProvider(view,{
    resolveCustomTextEditor(document,panel) {
      const web=panel.webview;
      web.options={enableScripts:true,localResourceRoots:[dist]};
      let entity:string,appearance:string,ready=false,timer:NodeJS.Timeout,pending:vscode.CancellationTokenSource;
      function cancel() {clearTimeout(timer);pending?.cancel();pending?.dispose();pending=undefined;}
      async function update() {
        cancel();
        if (!ready) return;
        const token=(pending=new vscode.CancellationTokenSource()).token;
        try {
          const card=await request({uri:document.uri.toString(),text:document.getText(),entity,appearance,card:true,locale:vscode.env.language},token);
          if (token.isCancellationRequested) return;
          entity=card.entity; appearance=card.appearance;
          await web.postMessage({card});
        } catch (error) {
          if (!token.isCancellationRequested) await web.postMessage({error:error.message});
        }
      }
      const messages=web.onDidReceiveMessage(message=>{
        if (message.type!=="ready" && message.type!=="select") return;
        ready=true;
        entity=message.entity; appearance=message.appearance;
        void update();
      });
      const edits=vscode.workspace.onDidChangeTextDocument(event=>{
        if (event.document!==document || !event.contentChanges.length) return;
        cancel(); timer=setTimeout(update,250);
      });
      const index=indexed(()=>void update());
      panel.onDidDispose(()=>{cancel();messages.dispose();edits.dispose();index.dispose();});
      const nonce=randomBytes(16).toString("base64");
      const script=web.asWebviewUri(vscode.Uri.joinPath(dist,"unit-card-viewer.js"));
      web.html=`<!doctype html><html lang="en"><head><meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'">
      <meta name="viewport" content="width=device-width,initial-scale=1"><style nonce="${nonce}">
      *{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;padding:16px;font:14px var(--vscode-font-family);color:var(--vscode-foreground)}
      main{max-width:830px;margin:auto}nav{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px}label{display:grid;gap:4px}select{max-width:100%;background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border);padding:4px}
      article{background:#25272a;color:#e0e1e2;border:1px solid #4c5054}header{background:#34373b;border-bottom:1px solid #484b4e;padding:5px 10px;font-size:13px}
      .identity{display:grid;grid-template-columns:minmax(60px,1fr) 3fr minmax(60px,1fr);align-items:start;text-align:center;padding:10px;gap:5px}
      #nation{font-size:12px;text-align:left;overflow-wrap:anywhere}#flag{display:block;height:28px;max-width:68px;object-fit:contain;margin-bottom:4px}h1{font-size:19px;font-weight:600;margin:0 0 3px}#classification{color:#b5b9bd}
      figure{margin:0;padding:0 12px 8px;text-align:center}#profile{display:block;width:100%;height:clamp(100px,27vw,220px);object-fit:contain}
      #missing{color:#b5b9bd;padding:16px}dl{margin:0}#facts{display:flex;flex-wrap:wrap;gap:6px 20px;padding:8px 12px;background:#2d3033}#facts div{display:flex;gap:5px}
      dt{color:#b7bec3}dd{margin:0}#groups div{display:grid;grid-template-columns:minmax(72px,auto) 1fr;gap:12px;padding:7px 12px}#groups div:nth-child(even){background:#303337}
      #description{border-top:1px solid #44484b;padding:12px;margin:0;white-space:pre-line;line-height:1.5}
      </style></head><body><main><nav hidden><label>Unit<select id="entity"></select></label><label><span id="appearance-label"></span><select id="appearance"></select></label></nav>
      <p role="status">Loading unit card…</p><article hidden aria-label="Unit Reference"><header>Unit Reference</header>
      <div class="identity"><div id="nation"><img id="flag" alt=""><span></span></div><div><h1></h1><div id="classification"></div></div></div>
      <figure><img id="profile" alt=""><div id="missing">No profile artwork found.</div></figure><dl id="facts"></dl><dl id="groups"></dl><p id="description"></p></article></main>
      <script nonce="${nonce}" src="${script}"></script></body></html>`;
    }
  });
  return vscode.Disposable.from(open,provider);
}
