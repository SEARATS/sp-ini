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
      .identity{display:grid;grid-template-columns:auto minmax(0,380px) minmax(110px,1fr);align-items:center;gap:8px;padding:6px 8px;background:#232528}
      .identity>div:first-child{align-self:start;margin-top:2px}
      #flag{width:32px;height:21px;object-fit:contain}#nation{font-size:12px;overflow-wrap:anywhere}
      h1{margin:0;color:#e2e5e8;font-size:18px;line-height:1.25;font-weight:500}#classification{margin-top:2px}
      #service{display:inline-block;background:#303337;padding:2px 6px;margin-top:6px}
      figure{margin:0}#profile{display:block;width:100%;height:112px;object-fit:contain}#missing{font-size:12px}
      dl,dd{margin:0}#facts{display:flex;flex-wrap:wrap;gap:4px;padding:8px 8px 4px}
      #facts>div{min-width:100px;background:#232528;padding:4px 8px}#facts dt{font-size:12px}#facts dd{color:#e2e5e8}
      article{background:#2b2d30}
      [role=tablist]{display:flex;flex-wrap:wrap;gap:2px;margin:4px 8px 0;border-bottom:1px solid #505458}
      [role=tab]{font:inherit;color:inherit;background:#232528;border:0;padding:5px 10px;cursor:pointer}
      [role=tab][aria-selected=true]{color:#efd09b;background:#3b3e41;box-shadow:inset 0 -2px #c5a36f}
      [role=tabpanel]{padding:10px}h2{font-size:15px;font-weight:500;color:#e2c390;margin:0 0 6px}
      [role=tabpanel] dl>div{display:flex;align-items:baseline;gap:8px;padding:5px 8px;margin:0 0 2px;background:#232528}
      [role=tabpanel] dd{display:flex;flex-wrap:wrap;gap:2px 10px;min-width:0;overflow-wrap:anywhere}
      #mount-list{margin-top:12px}#description{margin:10px 0 0;white-space:pre-line}
      @container(max-width:420px){.identity{grid-template-columns:auto minmax(0,1fr)}figure{grid-column:1/-1;grid-row:2}.names{grid-column:2;grid-row:1}}
      @media(forced-colors:active){[role=tab][aria-selected=true]{border-bottom:2px solid Highlight}}
      </style></head><body><main><nav hidden><label>Unit<select id="entity"></select></label><label><span id="appearance-label"></span><select id="appearance"></select></label></nav>
      <p role="status">Loading unit card…</p><article hidden aria-label="Unit Reference"><header>Unit Reference</header>
      <div class="identity"><div><img id="flag" alt=""><span id="nation" hidden></span></div>
      <figure><img id="profile" alt=""><div id="missing">No profile artwork found.</div></figure>
      <div class="names"><h1></h1><div id="classification"></div><span id="service" hidden></span></div></div><dl id="facts"></dl>
      <div role="tablist" aria-label="Unit details">${[["overview","Overview"],["armament","Armament"],["sensors","Sensors"],["air-wing","Air Wing"]].map(([id,label])=>
        `<button id="tab-${id}" role="tab" aria-controls="${id}">${label}</button>`).join("")}</div>
      <div id="groups"><section id="overview" role="tabpanel" aria-labelledby="tab-overview"><h2>Armament</h2><dl></dl><p id="description"></p></section>
      <section id="armament" role="tabpanel" aria-labelledby="tab-armament" hidden><h2>Armament</h2><dl></dl><div id="mount-list"><h2>Mounts</h2><dl></dl></div></section>
      ${["sensors","air-wing"].map(id=>`<section id="${id}" role="tabpanel" aria-labelledby="tab-${id}" hidden><dl></dl></section>`).join("")}</div>
      </article></main>
      <script nonce="${nonce}" src="${script}"></script></body></html>`;
    }
  });
  return vscode.Disposable.from(open,provider);
}
