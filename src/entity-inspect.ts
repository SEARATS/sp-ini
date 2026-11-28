import { Matrix4, Raycaster, Vector2, Vector3, type Object3D, type PerspectiveCamera } from "three";
import { previewLayer } from "./preview-display";
import type { EntityPart, EntityObject } from "./entity-model";
import {objectColor,type PreviewColor} from "./preview-colors";
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
    if (role) {
      // Flight overlays are drawn over the deck, including its system colliders.
      const priority=object.userData.deckPoint ? -2 : object.userData.routeKind ? -1 : hoverPriority[role];
      ranked.set(part,priority);
    }
    else mesh ??= part;
  }
  if (!ranked.size) return mesh ? [mesh] : [];
  return [...ranked.entries()].sort((a,b)=>a[1]-b[1]).map(([part])=>part);
}

// Flight paths can render a single pixel wide. Measure pointer distance in CSS
// pixels so the target stays usable when orbiting below deck or fitting a circuit.
export function nearbyFlightWidgets(widgets:Iterable<Object3D>, parts:ReadonlyMap<string,Inspectable>, camera:PerspectiveCamera,
  pointer:Vector2, width:number, height:number) {
  const hits:{object:Object3D; pixels:number; depth:number}[]=[];
  const view=new Matrix4(), a=new Vector3(), b=new Vector3(), start=new Vector3(), end=new Vector3();
  const clip=(z:number)=>Math.max(-camera.far,Math.min(-camera.near,z));
  for (const object of widgets) {
    const {deckPoint,routeKind,partId}=object.userData;
    if (!(deckPoint || routeKind) || !object.layers.isEnabled(routeKind ? previewLayer.route : previewLayer.widget)) continue;
    const obj=parts.get(partId);
    if (!obj || !("group" in obj)) continue;
    view.multiplyMatrices(camera.matrixWorldInverse,object.parent.matrixWorld);
    const points=obj.route?.points ?? [obj.position];
    let pixels=Infinity, depth=Infinity;
    for (let i=0;i<points.length;i++) {
      const [x,y,z]=points[i];
      b.set(-x,y,z).applyMatrix4(view);
      if (i===0) a.copy(b);
      if (Math.min(a.z,b.z)<=-camera.near && Math.max(a.z,b.z)>=-camera.far) {
        const dz=b.z-a.z;
        start.lerpVectors(a,b,dz ? (clip(a.z)-a.z)/dz : 0).applyMatrix4(camera.projectionMatrix);
        end.lerpVectors(a,b,dz ? (clip(b.z)-a.z)/dz : 1).applyMatrix4(camera.projectionMatrix);
        const ax=(start.x-pointer.x)*width/2, ay=(start.y-pointer.y)*height/2;
        const dx=(end.x-start.x)*width/2, dy=(end.y-start.y)*height/2;
        const t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy || 1)));
        const distance=Math.hypot(ax+t*dx,ay+t*dy);
        if (distance<pixels) { pixels=distance; depth=-Math.max(a.z,b.z); }
      }
      a.copy(b);
    }
    if (pixels<=5) hits.push({object,pixels,depth});
  }
  return hits.sort((a,b)=>a.pixels-b.pixels || a.depth-b.depth);
}

export function inspectEntity(canvas: HTMLCanvasElement, camera: PerspectiveCamera, model: () => Object3D, widgets:()=>Iterable<Object3D>, open: (id: string) => void,
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

  function firstOwner(part:Inspectable) {
    return ("referencedBy" in part ? part.referencedBy || [] : []).map(name=>parts.get("object:"+name.toLowerCase()))
      .filter((owner):owner is EntityObject=>!!owner && "group" in owner && inMode(owner.id))
      .sort((a,b)=>hoverPriority[objectColor(a.group)]-hoverPriority[objectColor(b.group)])[0];
  }
  function targetId(hits:Inspectable[],shift:boolean) {
    if (shift) return hits.find(part=>"collider" in part && part.collider)?.id;
    const first=hits[0];
    return first && (firstOwner(first)?.id ?? first.id);
  }
  function hint(hits:Inspectable[]) {
    if (!hits.some(part=>"collider" in part && part.collider)) return openHint;
    return openHint+" · Shift+click: collider";
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
    ray.params.Line.threshold = 0;
    const exact=ray.intersectObject(model(),true);
    if (exact.some(({object})=>object.userData.deckPoint || object.userData.routeKind)) return hoverStack(exact,parts);
    return hoverStack([...nearbyFlightWidgets(widgets(),parts,camera,pointer,rect.width,rect.height),...exact],parts);
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
      highlight("collider" in hits[0] && hits[0].collider ? hits.filter(part=>"collider" in part && part.collider).map(part=>part.id) : [hits[0].id]);
      tip.textContent = hits.map(description).join("\n\n")+"\n"+hint(hits);
      tip.scrollTop = 0;
      tip.hidden = false;
      tip.style.left = Math.max(0,Math.min(event.clientX+12,innerWidth-tip.offsetWidth))+"px";
      tip.style.top = Math.max(0,Math.min(event.clientY+14,innerHeight-tip.offsetHeight))+"px";
      canvas.classList.toggle("source-link", !!((event.ctrlKey || event.metaKey || event.shiftKey) && targetId(hits,event.shiftKey)));
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
    if ((event.ctrlKey || event.metaKey || event.shiftKey) && targetId(hitsAt(event),event.shiftKey)) event.stopImmediatePropagation();
  },true);
  canvas.addEventListener("click",event=>{
    if (event.button !== 0 || !press || Math.hypot(press.clientX-event.clientX,press.clientY-event.clientY)>4) return;
    // The click event can round CSS coordinates that pointerdown preserved.
    const hits=hitsAt(press), part=hits[0];
    press=undefined;
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      const id=targetId(hits,event.shiftKey);
      if (id) { select(event.shiftKey ? id : part.id); open(id); }
    }
    else select(part?.id);
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
      if (("collider" in part && part.collider) || "group" in part) {
        label.addEventListener("pointerenter",()=>highlight([id]));
        label.addEventListener("pointerleave",()=>highlight([]));
        label.addEventListener("focus",()=>highlight([id]));
        label.addEventListener("blur",()=>highlight([]));
      }
      function navigate(event:MouseEvent | KeyboardEvent) {
        const current=parts.get(id);
        if (!current || !(event.ctrlKey || event.metaKey || event.shiftKey) || event.target instanceof HTMLInputElement) return;
        const target=targetId([current],event.shiftKey);
        if (!target) return;
        event.preventDefault(); event.stopImmediatePropagation(); open(target);
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
