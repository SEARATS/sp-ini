import type { ExportCategory, ExportChoice, ExportRow } from "./export-plan";

declare function acquireVsCodeApi(): {postMessage(message: unknown): void};
const vscode = acquireVsCodeApi();
const get = (id: string) => document.getElementById(id);
const button = (id: string) => get(id) as HTMLButtonElement;
const enabled = new Set<ExportCategory>(), overrides = new Map<string, ExportChoice>();
const options = new Map<HTMLSelectElement, HTMLDivElement>();
const labels = {Mesh:"Meshes", Collider:"Colliders", Helper:"Transform helpers"};
let generation = 0, request = 0;

function changed() {
  for (const [select, row] of options) row.classList.toggle("off", !enabled.has(select.value as ExportCategory));
  for (const action of ["copy","new","apply"]) button(action).disabled = true;
  vscode.postMessage({type:"selection", categories:[...enabled], roles:[...overrides], request:++request});
}

function render(rows: ExportRow[], categories: ExportCategory[]) {
  options.clear();
  const checks = categories.map(category => {
    enabled.add(category);
    const input = document.createElement("input"), label = document.createElement("label");
    input.type = "checkbox"; input.checked = true;
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
    name.title = node.path + (node.mesh && node.mesh !== node.name ? "\nMesh: " + node.mesh : "");
    select.setAttribute("aria-label", "Export role for " + node.path);
    for (const role of [...categories.filter(c => node.mesh || c === "Helper"), "Skip"]) select.add(new Option(role, role));
    select.value = node.category;
    select.onchange = () => {
      if (select.value === node.category) overrides.delete(node.path);
      else overrides.set(node.path, select.value as ExportChoice);
      changed();
    };
    options.set(select, row);
    row.append(name, select);
    list.append(row);
  }
  get("objects").replaceChildren(list);
}

for (const type of ["copy","new","target","apply","clearTarget"]) {
  button(type).onclick = () => vscode.postMessage({type, generation});
}
window.addEventListener("message", ({data}) => {
  if (data.type === "model") render(data.rows, data.categories);
  if (data.type !== "preview" || data.request !== request || data.generation < generation) return;
  generation = data.generation;
  get("heading").textContent = data.target ? "Planned changes" : "Planned INI";
  get("targetName").textContent = data.target ?? "";
  get("preview").textContent = data.preview;
  get("status").textContent = data.error || (data.count ? data.count + (data.count === 1 ? " object" : " objects") : "No objects selected.");
  for (const action of ["copy","new"]) {
    button(action).hidden = !!data.target;
    button(action).disabled = !data.count || !!data.error;
  }
  button("apply").hidden = button("clearTarget").hidden = !data.target;
  button("apply").disabled = !data.count || !data.changed || !!data.error;
});
vscode.postMessage({type:"ready"});
