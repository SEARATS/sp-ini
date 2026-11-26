import type {unitCard} from "./unit-card";
type Card=Awaited<ReturnType<typeof unitCard>>;
declare function acquireVsCodeApi(): {postMessage(data:unknown):void;getState():{entity?:string;appearance?:string;tab?:string}|undefined;setState(data:unknown):void};
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
const tabs=Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
let tabId=vscode.getState()?.tab || "overview";
function selectTab(id:string) {
  tabId=tabs.some(t=>!t.hidden && t.getAttribute("aria-controls")===id) ? id : "overview";
  for (const tab of tabs) {
    const panel=tab.getAttribute("aria-controls"), selected=panel===tabId;
    tab.setAttribute("aria-selected",String(selected)); tab.tabIndex=selected ? 0 : -1;
    document.getElementById(panel).hidden=!selected;
  }
  vscode.setState({entity:entity.value,appearance:appearance.value,tab:tabId});
}
for (const tab of tabs) {
  tab.onclick=()=>selectTab(tab.getAttribute("aria-controls"));
  tab.onkeydown=event=>{
    const visible=tabs.filter(t=>!t.hidden), index=visible.indexOf(tab);
    const next={Home:0,End:visible.length-1,ArrowLeft:(index+visible.length-1)%visible.length,ArrowRight:(index+1)%visible.length}[event.key];
    if (next===undefined) return;
    event.preventDefault(); visible[next].focus(); visible[next].click();
  };
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
  rows("#facts",card.facts.map(f=>({label:f.label,values:[f.value]})));
  el("#service").textContent=card.serviceYears || ""; el("#service").hidden=!card.serviceYears;
  const weapons=card.groups.filter(g=>g.label==="Weapons" || g.label==="Defences");
  rows("#overview dl",weapons); rows("#armament dl",weapons);
  el("#mount-list").hidden=!card.installedMounts.length; rows("#mount-list dl",card.installedMounts);
  rows("#sensors dl",card.groups.filter(g=>g.label==="Sensors"));
  const wing=card.groups.filter(g=>g.label==="Aircraft" && g.values.some(v=>v!=="None"));
  el("#tab-air-wing").hidden=!wing.length; rows("#air-wing dl",wing);
  el("#description").textContent=card.description || ""; el("#description").hidden=!card.description;
  el("article").hidden=false;
  selectTab(tabId);
});
vscode.postMessage({type:"ready",...vscode.getState()});
