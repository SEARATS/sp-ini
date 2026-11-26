import { Raycaster, Vector2, type Object3D, type PerspectiveCamera } from "three";
import { previewLayer } from "./preview-display";
import type { EntityPart, EntityObject } from "./entity-model";

type Inspectable = EntityPart | EntityObject;

// Three returns intersections nearest first. Keep distance order within each category.
export function preferredHover(hits: readonly {object:Object3D}[], parts: ReadonlyMap<string,Inspectable>) {
  let collider: Inspectable, mesh: Inspectable;
  for (const {object} of hits) {
    const part = parts.get(object.userData.partId);
    if (!part) continue;
    if (object.userData.widget || object.userData.systemTarget) return part;
    if (object.layers.isEnabled(previewLayer.collider)) collider ??= part;
    else mesh ??= part;
  }
  return collider ?? mesh;
}

export function inspectEntity(canvas: HTMLCanvasElement, camera: PerspectiveCamera, model: () => Object3D, open: (id: string) => void, select: (id: string) => void) {
  const tip = document.querySelector<HTMLElement>("#part-tip");
  const parts = new Map<string,Inspectable>();
  const ray = new Raycaster(), pointer = new Vector2();
  ray.layers.enable(previewLayer.collider);
  ray.layers.enable(previewLayer.widget);
  const modifier = /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl";
  let scheduled = 0, press: PointerEvent;

  function description(part: EntityPart | EntityObject) {
    const {source} = part;
    const file = decodeURIComponent(new URL(source.uri).pathname.split("/").pop());
    const detail = "group" in part ? [part.system,part.placement].filter(Boolean).join("\n") :
      (part.collider ? "Collider" : "Mesh")+"="+(part.meshName || part.primitive || "Dummy");
    const owners = "referencedBy" in part && part.referencedBy?.length ? ["Used by "+part.referencedBy.map(name=>{
      const owner = parts.get("object:"+name.toLowerCase());
      return owner && "system" in owner && owner.system ? name+" ("+owner.system+")" : name;
    }).join(", ")] : [];
    return ["["+(part.id === "models" ? source.header : part.name)+"]", detail,...owners,
      file+" · line "+(source.line+1), modifier+"+click to open INI"].join("\n");
  }
  function hit(event: MouseEvent) {
    if (!parts.size || !model()) return;
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX-rect.left)/rect.width*2-1, 1-(event.clientY-rect.top)/rect.height*2);
    ray.setFromCamera(pointer,camera);
    return preferredHover(ray.intersectObject(model(),true),parts);
  }
  function hide() {
    cancelAnimationFrame(scheduled);
    tip.hidden = true;
    canvas.classList.remove("source-link");
  }
  canvas.addEventListener("pointermove",event=>{
    hide();
    if (event.buttons || !parts.size) return;
    scheduled = requestAnimationFrame(()=>{
      const part = hit(event);
      if (!part) return;
      tip.textContent = description(part);
      tip.hidden = false;
      tip.style.left = Math.max(0,Math.min(event.clientX+12,innerWidth-tip.offsetWidth))+"px";
      tip.style.top = Math.max(0,Math.min(event.clientY+14,innerHeight-tip.offsetHeight))+"px";
      canvas.classList.toggle("source-link", event.ctrlKey || event.metaKey);
    });
  });
  canvas.addEventListener("pointerleave",hide);
  canvas.addEventListener("pointercancel",()=>{press=undefined;hide();});
  canvas.addEventListener("pointerdown",event=>{
    hide(); press=undefined;
    if (event.button !== 0) return;
    press=event;
    if ((event.ctrlKey || event.metaKey) && hit(event)) event.stopImmediatePropagation();
  },true);
  canvas.addEventListener("click",event=>{
    if (event.button !== 0 || !press || Math.hypot(press.clientX-event.clientX,press.clientY-event.clientY)>4) return;
    press=undefined;
    const part=hit(event);
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
      label.title=description(part);
      label.addEventListener("click",event=>{
        if (!(event.ctrlKey || event.metaKey) || event.target instanceof HTMLInputElement) return;
        event.preventDefault(); event.stopPropagation(); open(id);
      });
      label.addEventListener("keydown",event=>{
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {event.preventDefault();open(id);}
      });
    },
    hide
  };
}
