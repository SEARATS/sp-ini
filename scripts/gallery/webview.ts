export async function renderedModel<T>(port: number, check: (input?: T) => string | Promise<string>, input?: T) {
  const seen = new Set<string>();
  const expression = "(" + check.toString() + ")(" + JSON.stringify(input) + ")";
  for (let attempt=0; attempt<40; attempt++) {
    const targets = await (await fetch("http://127.0.0.1:"+port+"/json/list")).json();
    for (const target of targets.filter(t=>t.type==="iframe" || t.type==="page")) {
      const statuses = await new Promise<string[]>(resolve=>{
        const ws = new WebSocket(target.webSocketDebuggerUrl), contexts = new Set<number>(), values: string[] = [];
        const timer = setTimeout(finish,1200);
        function finish() { clearTimeout(timer); ws.close(); resolve(values); }
        ws.onerror=finish;
        ws.onopen=()=>ws.send(JSON.stringify({id:1,method:"Runtime.enable"}));
        ws.onmessage=event=>{
          const msg=JSON.parse(String(event.data));
          if (msg.method==="Runtime.executionContextCreated") contexts.add(msg.params.context.id);
          if (msg.id===1) {
            if (!contexts.size) return finish();
            for (const id of contexts) ws.send(JSON.stringify({id:id+2,method:"Runtime.evaluate",params:{contextId:id,
              returnByValue:true,awaitPromise:true,expression}}));
          } else if (msg.id>1) {
            values.push(msg.result?.result?.value || msg.result?.exceptionDetails?.exception?.description || "empty");
            if (values.length>=contexts.size) finish();
          }
        };
      });
      statuses.forEach(status=>seen.add(target.type+" "+status));
      if (statuses.includes("verified controls")) return;
    }
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw Error("Model preview check timed out: "+[...seen].join(", "));
}
