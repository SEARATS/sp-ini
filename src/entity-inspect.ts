import { Raycaster, Vector2, type Object3D, type PerspectiveCamera } from "three";
import { previewLayer } from "./preview-display";
import { deckPointSection, type EntityPart, type EntityObject } from "./entity-model";
import type { PreviewColor } from "./preview-colors";
import type { IniSource } from "./ini";

type Inspectable = EntityPart | EntityObject;

export function sourceLocation(source: IniSource, documentUri: string) {
  const line="line "+(source.line+1);
  if (source.uri===documentUri) return line;
  const file=decodeURIComponent(new URL(source.uri).pathname.split("/").pop());
  return file+" · "+line;
}

function geometryLabel(part: EntityPart) {
  if (!part.collider) return "Mesh="+(part.meshName || "Dummy");
  if (part.primitive) return part.primitive === "sphere" ? "Sphere" : "Box";
  return part.meshName ? "Mesh · "+part.meshName : "Mesh";
}

const hoverPriority: Record<PreviewColor,number> = { weapon:0, sensor:2, flight:2, magazine:2, object:2, hull:3, unassigned:4, collider:4 };

// Three returns triangles nearest first. A stable sort keeps that order within a priority.
export function hoverStack(hits: readonly {object:Object3D}[], parts: ReadonlyMap<string,Inspectable>): Inspectable[] {
  const ranked = new Map<Inspectable,number>();
  let mesh: Inspectable;
  for (const {object} of hits) {
    const part = parts.get(object.userData.partId);
    if (!part || ranked.has(part)) continue;
    const role: PreviewColor = object.userData.previewRole;
    if (role) ranked.set(part,object.userData.deckPoint ? 1 : hoverPriority[role]);
    else mesh ??= part;
  }
  if (!ranked.size) return mesh ? [mesh] : [];
  return [...ranked.entries()].sort((a,b)=>a[1]-b[1]).map(([part])=>part);
}

export function inspectEntity(canvas: HTMLCanvasElement, camera: PerspectiveCamera, model: () => Object3D, open: (ids: string[]) => void,
  select: (id: string) => void, highlight: (ids:string[])=>void, inMode: (id:string)=>boolean) {
  const tip = document.querySelector<HTMLElement>("#part-tip");
  const parts = new Map<string,Inspectable>();
  const ray = new Raycaster(), pointer = new Vector2();
  ray.layers.enable(previewLayer.collider);
  ray.layers.enable(previewLayer.widget);
  ray.layers.enable(previewLayer.route);
  const modifier = /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl";
  const openHint = modifier+"+click to open INI";
  let scheduled = 0, press: PointerEvent;
  let documentUri: string;

  function owners(part:Inspectable) {
    return ("referencedBy" in part ? part.referencedBy || [] : []).map(name=>parts.get("object:"+name.toLowerCase()))
      .filter((owner):owner is EntityObject=>!!owner && "group" in owner && inMode(owner.id));
  }
  function targets(hits:Inspectable[],shift:boolean) {
    if (shift) return hits.filter(part=>"collider" in part && part.collider).slice(0,1).map(part=>part.id);
    const isDeckPoint = (p:Inspectable)=>p && "group" in p && deckPointSection.test(p.name);
    if (isDeckPoint(hits[0])) return hits.filter(isDeckPoint).map(p=>p.id);
    for (const part of hits) {
      if (!("collider" in part) || !part.collider) return [part.id];
      const ids=owners(part).map(owner=>owner.id);
      if (ids.length) return ids;
    }
    return [];
  }
  function hint(hits:Inspectable[]) {
    if (!hits.some(part=>"collider" in part && part.collider)) return openHint;
    const ids=targets(hits,false);
    const label = "group" in hits[0] && deckPointSection.test(hits[0].name) ? "point" : "system";
    return [ids.length && modifier+"+click: "+(ids.length===1 ? "" : "choose ")+label,"Shift+click: collider"].filter(Boolean).join(" · ");
  }
  function arcText(obj:EntityObject) {
    return [obj.firingArcs && "FiringArcs="+obj.firingArcs,obj.elevationArc && "ElevationArc="+obj.elevationArc].filter(Boolean);
  }

  function description(part: EntityPart | EntityObject) {
    const {source} = part;
    const detail = "group" in part ? [part.system,part.placement,...arcText(part)].filter(Boolean).join("\n") :
      geometryLabel(part);
    const references = "referencedBy" in part ? part.referencedBy?.filter(name=>inMode("object:"+name.toLowerCase())) : [];
    const usedBy = references?.length ? ["Used by "+references.map(name=>{
      const owner = parts.get("object:"+name.toLowerCase());
      return owner && "group" in owner ? [owner.system ? name+" ("+owner.system+")" : name,...arcText(owner)].join("\n") : name;
    }).join(", ")] : [];
    return ["["+(part.id === "models" ? source.header : part.name)+"]", detail,...usedBy,
      sourceLocation(source,documentUri)].join("\n");
  }
  function hitsAt(event: MouseEvent) {
    if (!parts.size || !model()) return [];
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX-rect.left)/rect.width*2-1, 1-(event.clientY-rect.top)/rect.height*2);
    ray.setFromCamera(pointer,camera);
    ray.params.Line.threshold = Math.max(camera.near, camera.position.length()*0.002);
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
      tip.textContent = hits.map(description).join("\n\n")+"\n"+hint(hits);
      tip.scrollTop = 0;
      tip.hidden = false;
      tip.style.left = Math.max(0,Math.min(event.clientX+12,innerWidth-tip.offsetWidth))+"px";
      tip.style.top = Math.max(0,Math.min(event.clientY+14,innerHeight-tip.offsetHeight))+"px";
      canvas.classList.toggle("source-link", !!((event.ctrlKey || event.metaKey || event.shiftKey) && targets(hits,event.shiftKey).length));
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
    if ((event.ctrlKey || event.metaKey || event.shiftKey) && targets(hitsAt(event),event.shiftKey).length) event.stopImmediatePropagation();
  },true);
  canvas.addEventListener("click",event=>{
    if (event.button !== 0 || !press || Math.hypot(press.clientX-event.clientX,press.clientY-event.clientY)>4) return;
    press=undefined;
    const hits=hitsAt(event), part=hits[0];
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      const ids=targets(hits,event.shiftKey);
      if (ids.length) open(ids);
    }
    else if (part && "group" in part) select(part.id);
    else if (part) {
      const linked=owners(part);
      if (linked.length===1) select(linked[0].id);
    }
  });
  return {
    setParts(next: (EntityPart | EntityObject)[], uri: string) {
      documentUri=uri;
      hide(); press=undefined; parts.clear();
      for (const part of next) if (part.source) parts.set(part.id,part);
    },
    link(label: HTMLElement, id: string) {
      const part=parts.get(id);
      if (!part) return;
      label.tabIndex=0;
      label.dataset.partId=id;
      label.title=description(part)+"\n"+hint([part]);
      if ("collider" in part && part.collider) {
        label.addEventListener("pointerenter",()=>highlight([id]));
        label.addEventListener("pointerleave",()=>highlight([]));
        label.addEventListener("focus",()=>highlight([id]));
        label.addEventListener("blur",()=>highlight([]));
      }
      function navigate(event:MouseEvent | KeyboardEvent) {
        const current=parts.get(id);
        if (!current || !(event.ctrlKey || event.metaKey || event.shiftKey) || event.target instanceof HTMLInputElement) return;
        const ids=targets([current],event.shiftKey);
        if (!ids.length) return;
        event.preventDefault(); event.stopImmediatePropagation(); open(ids);
      }
      label.addEventListener("click",navigate);
      label.addEventListener("keydown",event=>{
        if (event.key === "Enter") navigate(event);
      });
    },
    refreshLinks(root:HTMLElement) {
      for (const label of root.querySelectorAll<HTMLElement>("[data-part-id]")) {
        const part=parts.get(label.dataset.partId);
        if (part) label.title=description(part)+"\n"+hint([part]);
      }
    },
    hide
  };
}
