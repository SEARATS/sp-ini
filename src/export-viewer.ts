import type { ExportCategory, ExportChoice, ExportRow } from "./export-plan";
import type { RigAssets } from "./export-rig";
import { createRigViewer } from "./entity-rig-viewer";
import { categoryFor, lodLevel, specialRoles } from "./export-roles";
import { meshMoveButtons } from "./mesh-move-buttons";

declare function acquireVsCodeApi(): {postMessage(message: unknown): void};
const vscode = acquireVsCodeApi();
const get = (id: string) => document.getElementById(id);
const button = (id: string) => get(id) as HTMLButtonElement;
const enabled = new Set<ExportCategory>(), overrides = new Map<string, ExportChoice>();
const controls = new Map<string, {row:HTMLDivElement; select:HTMLSelectElement; chips:HTMLDivElement; add:HTMLButtonElement; node:ExportRow}>();
const labels = {Mesh:"Meshes", Collider:"Colliders", LOD:"LODs", Damaged:"Damage models", Helper:"Transform helpers"};
const distances: number[] = [];
let generation = 0, request = 0;
const rig = get("rig") as HTMLDetailsElement, links = get("parent-links") as HTMLInputElement;
let assets: RigAssets, viewer: ReturnType<typeof createRigViewer>, assetsRequested = false;
let plannedIni = "", drawnIni: string, rigError = "";

function updateRig() {
  if (!rig.open) return;
  const note = get("rig-note");
  if (rigError) { note.textContent = rigError; return; }
  if (!assets) {
    note.textContent = "Loading rig…";
    if (!assetsRequested) { assetsRequested = true; vscode.postMessage({type:"rigAssets"}); }
    return;
  }
  if (drawnIni === plannedIni) return;
  try {
    viewer ??= createRigViewer(rig.querySelector("canvas"), assets);
    note.textContent = viewer.update(plannedIni) || (plannedIni ? "" : "No rig to display.");
    viewer.showLinks(links.checked);
    drawnIni = plannedIni;
  } catch (e) { note.textContent = "Rig preview unavailable: " + e.message; }
}
rig.querySelector("summary").onclick = event => {
  event.preventDefault();
  rig.open = !rig.open;
  vscode.postMessage({type:"showRig", visible:rig.open});
  updateRig();
};
button("fit-rig").onclick = () => viewer?.fit();
links.onchange = () => viewer?.showLinks(links.checked);
window.addEventListener("pagehide", () => viewer?.dispose(), {once:true});

function changed() {
  updateControls();
  for (const action of ["copy","new","save","apply"]) button(action).disabled = true;
  vscode.postMessage({type:"selection", categories:[...enabled], roles:[...overrides], distances, request:++request});
}

function updateControls() {
  let levels = 0;
  for (const {node,row} of controls.values()) {
    const role = categoryFor(overrides.get(node.path) ?? node.category);
    row.classList.toggle("off", role === "Skip" || !enabled.has(role));
    if (role === "LOD" && enabled.has(role)) levels = Math.max(levels,lodLevel(node.name,node.mesh) || 0);
  }
  const settings = get("lod-settings");
  levels = Math.min(levels,64);
  while (settings.children.length > levels) settings.lastElementChild.remove();
  while (settings.children.length < levels) {
    const i = settings.children.length, label = document.createElement("label"), input = document.createElement("input");
    distances[i] ??= (i + 1) * 0.5;
    input.type = "number"; input.min = "0"; input.step = "any"; input.value = String(distances[i]);
    input.oninput = () => { distances[i] = input.valueAsNumber; changed(); };
    label.append("LOD" + (i + 1) + " distance (nmi) ", input);
    settings.append(label);
  }
}

function updateTags(rows: ExportRow[]) {
  const parent = (row:ExportRow) => row.path.slice(0,row.path.lastIndexOf("/"));
  const key = (row:ExportRow) => row.name + (/\[(\d+)\]$/.exec(row.path)?.[0]?.replace("["," [") ?? "");
  const groups = new Map<string,string[]>();
  for (const row of rows) {
    const path = parent(row);
    if (!groups.has(path)) groups.set(path,[]);
    groups.get(path).push(key(row));
  }
  const list = get("objects");
  for (const [index,node] of rows.entries()) {
    const control = controls.get(node.path);
    if (!control) continue;
    control.node = node;
    control.select.options[0].text = "Auto · " + node.category;
    const {chips,add} = control;
    const tagKey = JSON.stringify(node.tags);
    if (chips.dataset.tags !== tagKey) {
      if (chips.contains(document.activeElement)) add.focus();
      chips.dataset.tags = tagKey;
      chips.replaceChildren(...node.tags.map(tag => {
        const chip = document.createElement("span"), label = document.createElement("span"), remove = document.createElement("button");
        chip.className = "tag-chip";
        label.textContent = label.title = tag;
        remove.textContent = "×";
        remove.title = "Remove " + tag + " from " + node.name;
        remove.setAttribute("aria-label",remove.title);
        remove.onclick = () => vscode.postMessage({type:"removeTag",path:node.path,tag});
        chip.append(label,remove);
        return chip;
      }));
    }
    const siblings = groups.get(parent(node)), id = key(node);
    const moves = meshMoveButtons(node.name,id,siblings,direction => vscode.postMessage({type:"moveMesh",key:id,siblings,direction}));
    control.row.querySelector(".moves")?.remove();
    control.row.insertBefore(moves,control.select);
    const current = list.children[index];
    if (current !== control.row) list.insertBefore(control.row,current ?? null);
  }
  updateControls();
}

function render(rows: ExportRow[], categories: ExportCategory[]) {
  controls.clear();
  const checks = categories.map(category => {
    enabled.add(category);
    const input = document.createElement("input"), label = document.createElement("label");
    input.type = "checkbox"; input.checked = true;
    input.value = category;
    if (category === "LOD") label.title = "Write LOD levels and switching distances in [Models]. Sea Power finds each mesh by its _lodN suffix.";
    if (category === "Damaged") label.title = "Write damage model entries in [Models]. Sea Power finds unnumbered _d variants automatically.";
    input.onchange = () => {
      if (input.checked) enabled.add(category); else enabled.delete(category);
      changed();
    };
    label.append(input, labels[category]);
    return label;
  });
  document.querySelector(".categories").replaceChildren(...checks);
  const list = document.createDocumentFragment();
  for (const node of rows) {
    const row = document.createElement("div"), name = document.createElement("span"), select = document.createElement("select");
    row.className = "row";
    name.style.paddingInlineStart = Math.min(node.depth, 8) + "em";
    name.textContent = node.name;
    name.title = node.path + (node.mesh && node.mesh !== node.name ? "\nMesh: " + node.mesh : "") + (node.mesh ? "\n" + (node.triangles ?? 0).toLocaleString() + " triangles" : "");
    select.setAttribute("aria-label", "Export role for " + node.path);
    select.add(new Option("Auto", "Auto"));
    for (const role of [...(node.mesh ? [...categories,...specialRoles] : ["Helper"]), "Skip"]) select.add(new Option(role, role));
    select.onchange = () => {
      if (select.value === "Auto") overrides.delete(node.path);
      else overrides.set(node.path, select.value as ExportChoice);
      changed();
    };
    const tags = document.createElement("div"), chips = document.createElement("div"), add = document.createElement("button");
    tags.className = "tags"; tags.hidden = !node.mesh;
    chips.className = "tag-list";
    add.className = "add-tag";
    add.textContent = "+";
    add.title = "Add tags to " + node.name;
    add.setAttribute("aria-label",add.title);
    add.onclick = () => vscode.postMessage({type:"addTags",path:node.path});
    tags.append(chips,add);
    controls.set(node.path,{node,row,select,chips,add});
    row.append(name, tags, select);
    list.append(row);
  }
  get("objects").replaceChildren(list);
  updateTags(rows);
}

button("only-colliders").onclick = () => {
  enabled.clear(); enabled.add("Collider");
  for (const input of document.querySelectorAll<HTMLInputElement>("header label input[type=checkbox]")) input.checked = input.value === "Collider";
  changed();
};
for (const type of ["copy","new","save","target","apply","clearTarget"]) {
  button(type).onclick = () => vscode.postMessage({type, generation});
}
window.addEventListener("message", ({data}) => {
  if (data.type === "model") { render(data.rows, data.categories); rig.open = data.showRig; updateRig(); }
  if (data.type === "tags") updateTags(data.rows);
  if (data.type === "rigAssets") {
    assets = data.assets; rigError = data.error || "";
    updateRig();
  }
  if (data.type !== "preview" || data.request !== request || data.generation < generation) return;
  generation = data.generation;
  plannedIni = data.rigIni ?? data.preview;
  updateRig();
  get("heading").textContent = data.target ? "Planned changes" : "Planned INI";
  get("targetName").textContent = data.target ?? "";
  get("preview").textContent = data.preview;
  get("status").textContent = data.error || data.note || (data.count ? data.count + (data.count === 1 ? " object" : " objects") : "No exportable objects selected.");
  for (const action of ["copy","new","save"]) {
    button(action).hidden = !!data.target;
    button(action).disabled = !data.count || !!data.error;
  }
  button("apply").hidden = button("clearTarget").hidden = !data.target;
  button("apply").disabled = !data.count || !data.changed || !!data.error;
});
vscode.postMessage({type:"ready"});
