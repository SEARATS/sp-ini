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
      *{box-sizing:border-box}[hidden]{display:none!important}
      body{margin:0;padding:8px;font:13px var(--vscode-font-family);color:var(--vscode-foreground)}
      main{max-width:880px;margin:auto}
      nav{display:flex;flex-wrap:wrap;gap:6px 16px;margin-bottom:8px}
      label{display:flex;align-items:center;gap:6px;min-width:0}
      select{min-width:0;max-width:100%;background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border);padding:3px}
      article{container-type:inline-size;background:#232528;color:#b8bec4;border:1px solid #191a1c;font:14px/1.3 "Segoe UI",sans-serif}
      header{background:#1c1d20;padding:2px 5px;border-bottom:1px solid #131416;font-size:13px}
      .identity{position:relative;min-height:44px;padding:3px 13%;text-align:center}
      #flag,#nation{position:absolute;inset:0 auto auto 0;width:10%;max-height:54px;object-fit:contain;object-position:top left}
      #nation{overflow-wrap:anywhere;text-align:left;font-size:12px}
      h1{margin:0;font-size:18px;line-height:1.25;font-weight:500}#classification{margin-top:4px;font-size:12px}
      figure{margin:0;text-align:center}#profile{display:block;width:100%;height:clamp(95px,24cqw,220px);object-fit:contain}
      #missing{padding:18px 6px}dl,dd{margin:0}
      #facts{display:flex;flex-wrap:wrap;gap:3px 18px;background:#2b2d30;padding:5px}
      #facts div{display:flex;gap:4px}dt{flex:none}
      #groups>div{display:flex;align-items:baseline;gap:5px;padding:6px 5px}
      #groups>div:nth-child(even){background:#2b2d30}
      #groups dd{display:flex;flex-wrap:wrap;gap:1px 8px;min-width:0;overflow-wrap:anywhere}
      #description{padding:6px 5px;margin:0;white-space:pre-line}
      @media(forced-colors:active){header,#facts,#groups>div{border-bottom:1px solid CanvasText}}
      </style></head><body><main><nav hidden><label>Unit<select id="entity"></select></label><label><span id="appearance-label"></span><select id="appearance"></select></label></nav>
      <p role="status">Loading unit card…</p><article hidden aria-label="Unit Reference"><header>Unit Reference</header>
      <div class="identity"><img id="flag" alt=""><span id="nation" hidden></span><h1></h1><div id="classification"></div></div>
      <figure><img id="profile" alt=""><div id="missing">No profile artwork found.</div></figure><dl id="facts"></dl><dl id="groups"></dl><p id="description"></p></article></main>
      <script nonce="${nonce}" src="${script}"></script></body></html>`;
    }
  });
  return vscode.Disposable.from(open,provider);
}
