import type {unitCard} from "./unit-card";
type Card=Awaited<ReturnType<typeof unitCard>>;
declare function acquireVsCodeApi(): {postMessage(data:unknown):void;getState():{entity?:string;appearance?:string}|undefined;setState(data:unknown):void};
const vscode=acquireVsCodeApi();
const el=<T extends HTMLElement=HTMLElement>(selector:string)=>document.querySelector<T>(selector);
const entity=el<HTMLSelectElement>("#entity"), appearance=el<HTMLSelectElement>("#appearance");
function options(select:HTMLSelectElement,choices:Card["entities"],value:string) {
  if (choices.length!==select.length || choices.some((c,i)=>select.options[i].value!==c.id || select.options[i].text!==c.label))
    select.replaceChildren(...choices.map(c=>new Option(c.label,c.id)));
  select.value=value || "";
  select.parentElement.hidden=choices.length<2;
}
function picture(id:string,png:string,alt:string) {
  const img=el<HTMLImageElement>(id);
  img.hidden=!png;
  img.alt=alt;
  if (png) img.src="data:image/png;base64,"+png;
  else img.removeAttribute("src");
}
function rows(id:string,items:{label:string;values:string[]}[]) {
  const list=el(id);
  list.hidden=!items.length;
  list.replaceChildren(...items.map(({label,values})=>{
    const row=document.createElement("div"), term=document.createElement("dt"), text=document.createElement("dd");
    term.textContent=label+":";
    for (const value of values) {
      const item=document.createElement("span");
      item.textContent=value; text.append(item);
    }
    row.append(term,text); return row;
  }));
}
entity.onchange=()=>vscode.postMessage({type:"select",entity:entity.value});
appearance.onchange=()=>vscode.postMessage({type:"select",entity:entity.value,appearance:appearance.value});
window.addEventListener("message",({data}:{data:{card?:Card;error?:string}})=>{
  const card=data.card, status=el('[role="status"]');
  status.hidden=!!card; status.textContent=data.error || "";
  if (!card) {el("article").hidden=true; return;}
  options(entity,card.entities,card.entity); options(appearance,card.appearances,card.appearance);
  el("nav").hidden=entity.parentElement.hidden && appearance.parentElement.hidden;
  el("#appearance-label").textContent=card.appearances.some(c=>/^squadron/i.test(c.id)) ? "Squadron" : "Variant";
  if ("error" in card) {
    status.hidden=false; status.textContent=card.error; el("article").hidden=true; return;
  }
  el("h1").textContent=card.title; el("#classification").textContent=card.classification;
  picture("#flag",card.flag,card.nation || ""); el("#flag").title=card.nation || "";
  el("#nation").textContent=card.nation || ""; el("#nation").hidden=!!card.flag || !card.nation;
  picture("#profile",card.profile,card.title+" side profile"); el("#missing").hidden=!!card.profile;
  rows("#facts",card.facts.map(f=>({label:f.label,values:[f.value]}))); rows("#groups",card.groups);
  el("#description").textContent=card.description || ""; el("#description").hidden=!card.description;
  el("article").hidden=false;
  vscode.setState({entity:card.entity,appearance:card.appearance});
});
vscode.postMessage({type:"ready",...vscode.getState()});
