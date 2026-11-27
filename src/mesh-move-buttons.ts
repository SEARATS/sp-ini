export function meshMoveButtons(name: string, key:string, siblings:string[], move:(direction:number) => void) {
  const group = document.createElement("div");
  group.className = "moves";
  for (const direction of [-1,1]) {
    const button = document.createElement("button"), up = direction < 0;
    button.textContent = up ? "↑" : "↓";
    button.title = "Move " + name + (up ? " up" : " down");
    button.setAttribute("aria-label",button.title);
    button.disabled = key === siblings[up ? 0 : siblings.length-1];
    button.onclick = event => { event.preventDefault(); event.stopPropagation(); move(direction); };
    group.append(button);
  }
  return group;
}
