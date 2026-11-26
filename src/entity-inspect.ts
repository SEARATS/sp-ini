import { Raycaster, Vector2, type Object3D, type PerspectiveCamera } from "three";
import { previewLayer } from "./preview-display";
import type { EntityPart, EntityObject } from "./entity-model";
import type { PreviewColor } from "./preview-colors";

type Inspectable = EntityPart | EntityObject;

function geometryLabel(part: EntityPart) {
  if (!part.collider) return "Mesh="+(part.meshName || "Dummy");
  if (part.primitive) return part.primitive === "sphere" ? "Sphere" : "Box";
  return part.meshName ? "Mesh · "+part.meshName : "Mesh";
}

const hoverPriority: Record<PreviewColor,number> = { weapon:0, sensor:1, magazine:1, object:1, hull:2, unassigned:3, collider:3 };

// Three returns triangles nearest first. A stable sort keeps that order within a priority.
export function hoverStack(hits: readonly {object:Object3D}[], parts: ReadonlyMap<string,Inspectable>): Inspectable[] {
  const ranked = new Map<Inspectable,number>();
  let mesh: Inspectable;
  for (const {object} of hits) {
    const part = parts.get(object.userData.partId);
    if (!part || ranked.has(part)) continue;
    const role: PreviewColor = object.userData.previewRole;
    if (role) ranked.set(part,hoverPriority[role]);
    else mesh ??= part;
  }
  if (!ranked.size) return mesh ? [mesh] : [];
  return [...ranked.entries()].sort((a,b)=>a[1]-b[1]).map(([part])=>part);
}

export function inspectEntity(canvas: HTMLCanvasElement, camera: PerspectiveCamera, model: () => Object3D, open: (id: string) => void,
  select: (id: string) => void, highlight: (ids:string[])=>void) {
  const tip = document.querySelector<HTMLElement>("#part-tip");
  const parts = new Map<string,Inspectable>();
  const ray = new Raycaster(), pointer = new Vector2();
  ray.layers.enable(previewLayer.collider);
  ray.layers.enable(previewLayer.widget);
  const modifier = /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl";
  const openHint = modifier+"+click to open INI";
  let scheduled = 0, press: PointerEvent;

  function description(part: EntityPart | EntityObject) {
    const {source} = part;
    const file = decodeURIComponent(new URL(source.uri).pathname.split("/").pop());
    const detail = "group" in part ? [part.system,part.placement].filter(Boolean).join("\n") :
      geometryLabel(part);
    const owners = "referencedBy" in part && part.referencedBy?.length ? ["Used by "+part.referencedBy.map(name=>{
      const owner = parts.get("object:"+name.toLowerCase());
      return owner && "system" in owner && owner.system ? name+" ("+owner.system+")" : name;
    }).join(", ")] : [];
    return ["["+(part.id === "models" ? source.header : part.name)+"]", detail,...owners,
      file+" · line "+(source.line+1)].join("\n");
  }
  function hitsAt(event: MouseEvent) {
    if (!parts.size || !model()) return [];
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX-rect.left)/rect.width*2-1, 1-(event.clientY-rect.top)/rect.height*2);
    ray.setFromCamera(pointer,camera);
    return hoverStack(ray.intersectObject(model(),true),parts);
  }
  function hide() {
    cancelAnimationFrame(scheduled);
    tip.hidden = true;
    canvas.classList.remove("source-link");
    highlight([]);
  }
  canvas.addEventListener("pointermove",event=>{
    cancelAnimationFrame(scheduled);
    if (event.buttons || !parts.size) { hide(); return; }
    scheduled = requestAnimationFrame(()=>{
      const hits = hitsAt(event);
      if (!hits.length) { hide(); return; }
      highlight(hits.filter(part=>"collider" in part && part.collider).map(part=>part.id));
      tip.textContent = hits.map(description).join("\n\n")+"\n"+(hits.length === 1 ? openHint : modifier+"+click to open the first entry");
      tip.scrollTop = 0;
      tip.hidden = false;
      tip.style.left = Math.max(0,Math.min(event.clientX+12,innerWidth-tip.offsetWidth))+"px";
      tip.style.top = Math.max(0,Math.min(event.clientY+14,innerHeight-tip.offsetHeight))+"px";
      canvas.classList.toggle("source-link", event.ctrlKey || event.metaKey);
    });
  });
  canvas.addEventListener("wheel",event=>{
    if (tip.hidden || !event.altKey || tip.scrollHeight <= tip.clientHeight) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const step = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? tip.clientHeight : 1;
    tip.scrollTop += event.deltaY * step;
  },{capture:true,passive:false});
  canvas.addEventListener("pointerleave",hide);
  canvas.addEventListener("pointercancel",()=>{press=undefined;hide();});
  canvas.addEventListener("pointerdown",event=>{
    hide(); press=undefined;
    if (event.button !== 0) return;
    press=event;
    if ((event.ctrlKey || event.metaKey) && hitsAt(event).length) event.stopImmediatePropagation();
  },true);
  canvas.addEventListener("click",event=>{
    if (event.button !== 0 || !press || Math.hypot(press.clientX-event.clientX,press.clientY-event.clientY)>4) return;
    press=undefined;
    const [part]=hitsAt(event);
    if (part && (event.ctrlKey || event.metaKey)) open(part.id);
    else if (part && "group" in part) select(part.id);
  });
  return {
    setParts(next: (EntityPart | EntityObject)[]) {
      hide(); press=undefined; parts.clear();
      for (const part of next) if (part.source) parts.set(part.id,part);
    },
    link(label: HTMLElement, id: string) {
      const part=parts.get(id);
      if (!part) return;
      label.tabIndex=0;
      label.dataset.partId=id;
      label.title=description(part)+"\n"+openHint;
      if ("collider" in part && part.collider) {
        label.addEventListener("pointerenter",()=>highlight([id]));
        label.addEventListener("pointerleave",()=>highlight([]));
        label.addEventListener("focus",()=>highlight([id]));
        label.addEventListener("blur",()=>highlight([]));
      }
      label.addEventListener("click",event=>{
        if (!(event.ctrlKey || event.metaKey) || event.target instanceof HTMLInputElement) return;
        event.preventDefault(); event.stopPropagation(); open(id);
      });
      label.addEventListener("keydown",event=>{
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {event.preventDefault();open(id);}
      });
    },
    refreshLinks(root:HTMLElement) {
      for (const label of root.querySelectorAll<HTMLElement>("[data-part-id]")) {
        const part=parts.get(label.dataset.partId);
        if (part) label.title=description(part)+"\n"+openHint;
      }
    },
    hide
  };
}
