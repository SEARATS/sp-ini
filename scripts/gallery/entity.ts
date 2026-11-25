// Runs inside the actual preview. Find the part under a painted pixel using its normal hover handler.
export async function inspectSpruance(mode: "mesh" | "sphere" | "open" | "hierarchy") {
  const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label*="spruance"]');
  if (!canvas || !document.querySelector("[role=status]")?.textContent.includes("Drag to orbit")) return "waiting for Spruance";
  const tip = document.querySelector<HTMLElement>("#part-tip");
  if (mode === "open") {
    const point = JSON.parse(canvas.dataset.galleryPoint);
    canvas.dispatchEvent(new PointerEvent("pointerdown", {...point, ctrlKey:true, bubbles:true}));
    canvas.dispatchEvent(new MouseEvent("click", {...point, ctrlKey:true, bubbles:true}));
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
  document.querySelector<HTMLDetailsElement>("#outline").open = false;
  for (const id of ["meshes","colliders"]) {
    const control = document.querySelector<HTMLInputElement>("#"+id);
    if (control.checked !== (mode === "mesh" ? id === "meshes" : id === "colliders")) control.click();
  }
  document.querySelector("button").click(); // Fit before each capture so retries use the same camera.
  canvas.dispatchEvent(new WheelEvent("wheel",{deltaY:mode === "sphere" ? -2200 : -970,cancelable:true}));
  const sample = document.createElement("canvas");
  sample.width = canvas.clientWidth;
  sample.height = canvas.clientHeight;
  const ctx = sample.getContext("2d");
  document.querySelector("#meshWireframe").dispatchEvent(new Event("change"));
  ctx.drawImage(canvas,0,0,sample.width,sample.height);
  const pixels = ctx.getImageData(0,0,sample.width,sample.height).data;
  const points: {clientX:number; clientY:number}[] = [];
  for (let y=8; y<sample.height-15; y+=4) for (let x=15; x<sample.width-15; x+=4) {
    const i = 4*(y*sample.width+x);
    if (pixels[i+3] > 128) points.push({clientX:x,clientY:y});
  }
  if (mode === "mesh") {
    const distance = p => Math.hypot(p.clientX-sample.width*0.47,p.clientY-sample.height*0.5);
    points.sort((a,b)=>distance(a)-distance(b));
  }
  for (const point of points.slice(0,100)) {
    canvas.dispatchEvent(new PointerEvent("pointermove",{...point,ctrlKey:true}));
    await new Promise<void>(resolve => requestAnimationFrame(()=>resolve()));
    if (tip.hidden || !tip.textContent.includes(mode === "sphere" ? "Collider=Sphere" : "Mesh=")) continue;
    canvas.dataset.galleryPoint = JSON.stringify(point);
    return "verified controls";
  }
  return "Could not hover a visible "+mode+" ("+points.length+" painted samples)";
}
