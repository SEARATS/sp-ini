import * as fs from "node:fs/promises";
import * as path from "node:path";
import { PNG } from "pngjs";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, message) {
  for (let i = 0; i < 120; i++) {
    if (await check()) return;
    await delay(100);
  }
  throw Error(message);
}

// Runs inside the workbench renderer. Measure the visible glyphs and widget, not the editor pane.
function measure({ lines, after = 0, widget, tab, canvas, preview }) {
  const editor = document.querySelector(".part.editor");
  const viewport = editor.getBoundingClientRect();
  if (canvas || preview) {
    const [left,top,right,bottom] = Array.isArray(preview) ? preview : [0,0,1,1];
    return {x:viewport.x+left*viewport.width, y:viewport.y+top*viewport.height,
      width:(right-left)*viewport.width, height:(bottom-top)*viewport.height, scale:1};
  }
  const boxes = [];
  const visible = el => {
    const r = el.getBoundingClientRect();
    return r.width && r.height && r.bottom > viewport.top && r.top < viewport.bottom && getComputedStyle(el).visibility !== "hidden";
  };
  const views = [...editor.querySelectorAll<HTMLElement>(".view-line")].filter(visible).sort((a, b) => a.offsetTop - b.offsetTop);
  const cursorY = editor.querySelector(".cursor")?.getBoundingClientRect().top ?? (viewport.top + viewport.bottom) / 2;
  for (const needle of lines || []) {
    const matches = views.filter(el => el.innerText.replace(/\u00a0/g, " ").trim().startsWith(needle));
    if (!matches.length) return null;
    const el = matches.reduce((best, next) => Math.abs(next.getBoundingClientRect().top - cursorY) < Math.abs(best.getBoundingClientRect().top - cursorY) ? next : best);
    const first = views.indexOf(el);
    for (const line of views.slice(first, first + 1 + after)) {
      const range = document.createRange();
      range.selectNodeContents(line);
      const r = range.getBoundingClientRect();
      boxes.push({ left: viewport.left + 4, top: r.top, right: Math.min(r.right, r.left + 610), bottom: r.bottom });
    }
  }
  if (widget) {
    const el = [...document.querySelectorAll(widget)].find(visible);
    if (!el) return null;
    boxes.push(el.getBoundingClientRect());
  }
  if (tab) {
    const el = editor.querySelector(".tab.active");
    if (el) boxes.push(el.getBoundingClientRect());
  }
  if (!boxes.length) return null;
  const x = Math.max(0, Math.floor(Math.min(...boxes.map(r => r.left))) - 16);
  const y = Math.max(0, Math.floor(Math.min(...boxes.map(r => r.top))) - 34);
  return { x, y, width: Math.min(innerWidth, Math.max(x + 380, Math.ceil(Math.max(...boxes.map(r => r.right))) + 30)) - x,
    height: Math.min(innerHeight, Math.ceil(Math.max(...boxes.map(r => r.bottom))) + 34) - y, scale: 1 };
}

function cropModel(bytes) {
  const src = PNG.sync.read(bytes);
  let left = src.width, right = 0, top = src.height, bottom = 0;
  for (let y = 95; y < src.height - 20; y++) for (let x = 20; x < src.width - 20; x++) {
    const i = 4 * (y * src.width + x);
    if (Math.min(src.data[i], src.data[i + 1], src.data[i + 2]) < 130) continue;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right <= left || bottom <= top) throw Error("No rendered stock mesh in the model preview");
  left = 0; right = Math.min(src.width, right + 36);
  top = 0; bottom = Math.min(src.height, bottom + 36);
  const cropped = new PNG({ width: right - left, height: bottom - top });
  PNG.bitblt(src, cropped, left, top, cropped.width, cropped.height, 0, 0);
  return PNG.sync.write(cropped);
}

async function camera() {
  const pages = await (await fetch("http://127.0.0.1:" + process.env.SP_GALLERY_PORT + "/json/list")).json();
  const page = pages.find(p => p.type === "page" && p.url.includes("workbench"));
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map(), images = [];
  socket.onmessage = event => {
    const reply = JSON.parse(event.data);
    pending.get(reply.id)?.(reply);
    pending.delete(reply.id);
  };
  const call = <T = void>(method: string, params = {}) => new Promise<T>((resolve, reject) => {
    const request = ++id;
    pending.set(request, reply => reply.error ? reject(Error(reply.error.message)) : resolve(reply.result));
    socket.send(JSON.stringify({ id: request, method, params }));
  });
  const evaluate = async expression => (await call<{result:{value:unknown}}>("Runtime.evaluate", { expression, returnByValue: true })).result.value;
  const resize = (width, height) => call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await resize(1120, 800);
  return {
    close: () => socket.close(),
    resize,
    async pan(x:number,y:number,dx:number,dy:number) {
      const start={x,y,button:"left",buttons:1,modifiers:8};
      await call("Input.dispatchMouseEvent",{...start,type:"mousePressed",clickCount:1});
      await call("Input.dispatchMouseEvent",{...start,type:"mouseMoved",x:x+dx,y:y+dy});
      await call("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",x:x+dx,y:y+dy,clickCount:1});
    },
    async escape() {
      for (const type of ["keyDown", "keyUp"]) await call("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    },
    async rendered(alt, count = 1) {
      await waitFor(() => evaluate('Array.from(document.querySelectorAll(".monaco-hover img")).filter(i => i.alt === ' +
        JSON.stringify(alt) + ' && i.naturalWidth > 0 && i.getBoundingClientRect().height > 0).length >= ' + count), "Missing hover image: " + alt);
    },
    async capture(file, title, region) {
      if (region.canvas) {
        await resize(680, 460);
        await delay(300);
        await call("Input.dispatchMouseEvent", { type: "mouseWheel", x: 350, y: 250, deltaX: 0, deltaY: -180 });
      }
      await delay(220);
      let clip;
      await waitFor(async () => {
        clip = await evaluate("(" + measure.toString() + ")(" + JSON.stringify(region) + ")");
        return clip?.width > 8 && clip.height > 8;
      }, "Could not frame " + file);
      const { data } = await call<{data:string}>("Page.captureScreenshot", { format: "png", fromSurface: true, clip });
      const bytes = Buffer.from(data, "base64");
      await fs.writeFile(path.join(process.env.SP_GALLERY_OUTPUT, file + ".png"), region.canvas ? cropModel(bytes) : bytes);
      if (region.canvas) await resize(1120, 800);
      images.push({ file, title });
    },
    async finish() {
      const figures = images.map(({ file, title }) => '<figure><figcaption>' + title + '</figcaption><a href="' + file + '.png"><img src="' +
        file + '.png" alt="' + title + '"></a></figure>').join("\n");
      const html = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<title>Sea Power INI features</title><style>body{font:16px system-ui;color:#e6edf3;background:#17191d;margin:2rem auto;padding:0 1rem;max-width:920px}' +
        'figure{margin:2rem 0}figcaption{margin-bottom:.5rem;font-weight:600}img{display:block;max-width:100%;height:auto}</style>' +
        '<h1>Sea Power INI features</h1><p>Captured in VS Code using stock Spruance VLS geometry and textures exported locally, and a working copy of its INI.</p>' + figures + '</html>';
      const markdown = ["# Sea Power INI screenshots", "Captured in VS Code with the stock Spruance VLS destroyer.",
        ...images.map(({ file, title }) => "## " + title + "\n\n![" + title + "](" + file + ".png)")].join("\n\n");
      await fs.writeFile(path.join(process.env.SP_GALLERY_OUTPUT, "README.md"), markdown + "\n");
      await fs.writeFile(path.join(process.env.SP_GALLERY_OUTPUT, "index.html"), html);
    }
  };
}

export { camera, delay, waitFor };
