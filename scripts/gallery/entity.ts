// Runs inside the actual preview. Find the part under a painted pixel using its normal hover handler.
export async function inspectSpruance(mode: "overview" | "mesh" | "sphere" | "overlap" | "trees" | "arcs" | "open" | "hierarchy") {
  const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label*="spruance"]');
  if (!canvas || !document.querySelector("[role=status]")?.textContent.includes("Drag to orbit")) return "waiting for Spruance";
  const tip = document.querySelector<HTMLElement>("#part-tip");
  if (mode === "open") {
    const point = JSON.parse(canvas.dataset.galleryPoint);
    canvas.dispatchEvent(new PointerEvent("pointerdown", {...point, shiftKey:true, bubbles:true}));
    canvas.dispatchEvent(new MouseEvent("click", {...point, shiftKey:true, bubbles:true}));
    return "verified controls";
  }
  if (mode === "hierarchy") {
    const meshes = document.querySelector<HTMLInputElement>("#meshes");
    if (!meshes.checked) meshes.click();
    const label = Array.from(document.querySelectorAll<HTMLElement>("#outline [title]"))
      .find(e=>e.title.startsWith("[VLS_Module_Fwd_L_1]\nMesh="));
    if (!label) return "waiting for repeated mesh";
    for (let el: HTMLElement = label; el; el = el.parentElement) if (el instanceof HTMLDetailsElement) el.open = true;
    label.scrollIntoView({block:"center"});
    label.focus();
    label.dispatchEvent(new MouseEvent("click",{ctrlKey:true,bubbles:true,cancelable:true}));
    return "verified controls";
  }
  const outline=document.querySelector<HTMLDetailsElement>("#outline");
  outline.open = mode === "trees";
  for (const id of ["meshes","colliders","objects","arcs"]) {
    const control = document.querySelector<HTMLInputElement>("#"+id);
    const on=id==="arcs" || id==="objects" ? mode==="trees" || mode==="arcs" : id==="meshes" ? mode!=="sphere" : !["overview","mesh","arcs"].includes(mode);
    if (control.checked !== on) control.click();
  }
  document.querySelector("button").click(); // Fit before each capture so retries use the same camera.
  canvas.dispatchEvent(new WheelEvent("wheel",{deltaY:mode === "sphere" ? -2200 : mode === "overview" ? -1850 : -970,cancelable:true}));
  if (mode==="overview") return "verified controls";
  if (mode==="arcs") {
    document.querySelector<HTMLElement>('[data-part-id="object:weaponsystem7"]').click();
    const legend=document.querySelector<HTMLElement>("#arc-values");
    return !legend.hidden && legend.textContent.includes("FiringArcs=-120,120") ? "verified controls" : "waiting for arc guides";
  }
  if (mode === "trees") {
    for (const branch of outline.querySelectorAll<HTMLDetailsElement>("details[data-branch]"))
      branch.open=branch.dataset.branch==="Objects";
    outline.scrollTop=0;
    return "verified controls";
  }
  const sample = document.createElement("canvas");
  sample.width = canvas.clientWidth;
  sample.height = canvas.clientHeight;
  const ctx = sample.getContext("2d");
  const style=document.querySelector<HTMLSelectElement>("#colliderWireframe");
  if (mode==="overlap") { style.value="shaded"; style.dispatchEvent(new Event("change")); }
  document.querySelector("#meshWireframe").dispatchEvent(new Event("change"));
  ctx.drawImage(canvas,0,0,sample.width,sample.height);
  if (mode==="overlap") { style.value="wireframe"; style.dispatchEvent(new Event("change")); }
  const pixels = ctx.getImageData(0,0,sample.width,sample.height).data;
  const points: {clientX:number; clientY:number}[] = [];
  const step=mode==="overlap" ? 1 : 4;
  for (let y=8; y<sample.height-15; y+=step) for (let x=15; x<sample.width-15; x+=step) {
    const i = 4*(y*sample.width+x);
    if (mode==="overlap" && !(pixels[i]>190 && pixels[i+1]<115 && pixels[i+2]<115)) continue;
    if (pixels[i+3] > 128) points.push({clientX:x,clientY:y});
  }
  if (mode === "mesh") {
    const distance = p => Math.hypot(p.clientX-sample.width*0.47,p.clientY-sample.height*0.5);
    points.sort((a,b)=>distance(a)-distance(b));
  }
  const candidates=mode==="overlap" ? points.filter((_,i)=>i%Math.max(1,Math.floor(points.length/60))===0) : points;
  for (const point of candidates.slice(0,100)) {
    canvas.dispatchEvent(new PointerEvent("pointermove",{...point,ctrlKey:true}));
    await new Promise<void>(resolve => requestAnimationFrame(()=>resolve()));
    if (tip.hidden) continue;
    const entries=tip.textContent.split("\n\n");
    if (mode==="overlap" && !(entries.length>=2 && /Used by .*WeaponSystem/i.test(entries[0]))) continue;
    if (mode==="sphere" && !/^\[coll_[^\n]+\]\nSphere\n/i.test(entries[0])) continue;
    if (mode==="mesh" && !entries[0].includes("Mesh=")) continue;
    canvas.dataset.galleryPoint = JSON.stringify(point);
    return "verified controls";
  }
  return "Could not hover a visible "+mode+" ("+points.length+" painted samples)";
}
